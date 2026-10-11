import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Auth } from './auth.js';

interface Subscriber {
  request: FastifyRequest;
  reply: FastifyReply;
  content: string;
}

function snapshotContent(value: unknown): string {
  // The timestamp describes this read, rather than a change to the dashboard.
  return JSON.stringify(value, function (key, item) {
    return this === value && key === 'generatedAt' ? undefined : item;
  });
}

// One authenticated snapshot stream per tab. No data or credentials enter logs.
export function registerDashboardEvents(
  app: FastifyInstance,
  auth: Pick<Auth, 'session' | 'config'>,
  snapshot: () => Promise<unknown>,
) {
  const subscribers = new Set<Subscriber>();
  let publishing: Promise<void> | undefined;
  let pinging: Promise<void> | undefined;
  let publishAgain = false;
  let pending = 0;
  let closing = false;

  function close(subscriber: Subscriber, event?: 'signed-out' | 'unavailable'): void {
    subscribers.delete(subscriber);
    if (subscriber.reply.raw.writableNeedDrain) subscriber.reply.raw.destroy();
    else if (!subscriber.reply.raw.destroyed) {
      if (event) subscriber.reply.raw.write(`event: ${event}\ndata: {}\n\n`);
      subscriber.reply.raw.end();
    }
  }

  function send(subscriber: Subscriber, data: string): void {
    // Allow one snapshot to drain, but never queue another for a slow connection.
    if (subscriber.reply.raw.destroyed || subscriber.reply.raw.writableNeedDrain) {
      subscribers.delete(subscriber);
      subscriber.reply.raw.destroy();
    }
    else subscriber.reply.raw.write(data);
  }

  async function update(): Promise<void> {
    if (subscribers.size === 0) return;
    try {
      const value = await snapshot(), content = snapshotContent(value);
      const data = `event: dashboard\ndata: ${JSON.stringify(value)}\n\n`;
      for (const subscriber of subscribers) {
        if (!await auth.session(subscriber.request)) close(subscriber, 'signed-out');
        else if (subscriber.content !== content) {
          send(subscriber, data);
          subscriber.content = content;
        }
      }
    } catch {
      for (const subscriber of subscribers) close(subscriber, 'unavailable');
    }
  }

  async function ping(): Promise<void> {
    try {
      for (const subscriber of subscribers) {
        if (!await auth.session(subscriber.request)) close(subscriber, 'signed-out');
        // A large changed snapshot may still be draining from this same heartbeat.
        // The optional comment must not mistake that healthy write for a slow tab.
        else if (!subscriber.reply.raw.writableNeedDrain) send(subscriber, ': ping\n\n');
      }
    } catch {
      for (const subscriber of subscribers) close(subscriber, 'unavailable');
    }
  }

  async function publish(): Promise<void> {
    if (publishing) {
      publishAgain = true;
      return await publishing;
    }
    publishing = (async () => {
      do {
        publishAgain = false;
        await update();
      } while (publishAgain);
    })();
    try { await publishing; }
    finally { publishing = undefined; }
  }

  app.get('/api/events', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.headers.origin && request.headers.origin !== auth.config.origin) {
      return reply.code(403).send({ error: 'Request origin is not allowed.' });
    }
    if (closing || subscribers.size + pending >= 32) return reply.code(503).send({ error: 'Too many open dashboard tabs.' });
    pending++;
    try {
      // Load before hijacking so failures still follow the normal safe error handler.
      const value = await snapshot(), data = JSON.stringify(value);
      if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
      if (closing) return reply.code(503).send({ error: 'The service is restarting.' });
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const subscriber = { request, reply, content: snapshotContent(value) };
      subscribers.add(subscriber);
      reply.raw.once('close', () => { subscribers.delete(subscriber); });
      send(subscriber, `retry: 15000\nevent: dashboard\ndata: ${data}\n\n`);
    } finally { pending--; }
  });

  const heartbeat = setInterval(() => {
    // Source workers commit in the background, so check for changed content here
    // as well as after actions. Unchanged dashboards receive only the comment.
    if (!pinging) pinging = (async () => { await publish(); await ping(); })()
      .finally(() => { pinging = undefined; });
  }, 15_000);
  heartbeat.unref();
  app.addHook('onResponse', async (request) => {
    if (request.method === 'POST' && request.routeOptions.url === '/auth/logout') await publish();
  });
  app.addHook('preClose', async () => {
    closing = true;
    clearInterval(heartbeat);
    for (const subscriber of subscribers) close(subscriber);
    await publishing;
    await pinging;
  });
  return { publish };
}
