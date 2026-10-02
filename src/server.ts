import { createApp } from './app.js';
import { openPostgres } from './db.js';
import { migrate } from './migrate.js';
import { ConfigError, readRuntime } from './runtime.js';

async function main(): Promise<void> {
  const config = readRuntime();
  const db = openPostgres(config.databaseUrl);
  try {
    await migrate(db);
    const app = await createApp(db, config, process.env);
    app.addHook('onClose', async () => { await db.close(); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => { void app.close(); });
    }
    await app.listen({ host: config.host, port: config.port });
    console.info('One of One Pulse is listening.');
  } catch {
    await db.close();
    throw new Error('Startup failed');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError
    ? `Pulse could not start: ${error.message}`
    : 'Pulse could not start. Check database access, migrations and runtime configuration.');
  process.exitCode = 1;
});
