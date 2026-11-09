import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContainer } from './bootstrap/container';
import { loadConfig } from './config';
import { createApp } from './http/app';
import { jsonLogger as logger } from './http/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const here = path.dirname(fileURLToPath(import.meta.url));
  config.webDistDir ??= path.resolve(here, '../../web/dist');

  const container = await createContainer(config);
  const app = createApp(container, logger);

  const server = app.listen(config.port, () => {
    logger.info('PRMS API listening', {
      port: config.port,
      env: config.env,
      storage: config.storage.kind,
      demoData: config.seedDemoData,
    });
  });

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      void container.persistence.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('Failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
