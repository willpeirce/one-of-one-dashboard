import { createApp } from './app.js';
import { openPostgres } from './db.js';
import { migrate } from './migrate.js';
import { logNodeVersion, readRuntime } from './runtime.js';
import { failureMessage } from './diagnostics.js';

async function main(): Promise<void> {
  logNodeVersion();
  const config = readRuntime();
  const db = openPostgres(config.databaseUrl);
  try {
    await migrate(db);
    console.info('Database migrations complete.');
    const app = await createApp(db, config, process.env);
    app.addHook('onClose', async () => { await db.close(); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => { void app.close(); });
    }
    await app.listen({ host: config.host, port: config.port });
    console.info('One of One Pulse is listening.');
    void app.startBackgroundWork();
  } catch (error) {
    // Cleanup must not replace the original migration or system code.
    await db.close().catch(() => {});
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(failureMessage('startup', error));
  process.exitCode = 1;
});
