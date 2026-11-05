import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { Role } from '@prms/domain';
import type { AppContainer } from '../bootstrap/container';
import { errorHandler } from './errorHandler';
import type { Logger } from './logger';
import { authenticate, requireRole } from './middleware/authenticate';
import { requestLogger } from './middleware/requestLogger';
import { adminRoutes } from './routes/adminRoutes';
import { authRoutes } from './routes/authRoutes';
import { metaRoutes } from './routes/metaRoutes';
import { passengerRoutes } from './routes/passengerRoutes';

export function createApp(container: AppContainer, logger: Logger): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  if (container.config.env !== 'test') app.use(requestLogger(logger));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: container.domain.clock.now().toISOString() });
  });
  app.use('/api/meta', metaRoutes());
  app.use('/api/auth', authRoutes(container));

  const authenticated = authenticate(container.tokens);
  app.use('/api/admin', authenticated, requireRole(Role.CREW_LEAD), adminRoutes(container));
  app.use('/api', authenticated, passengerRoutes(container));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such API endpoint.' } });
  });

  serveWebClient(app, container.config.webDistDir, logger);
  app.use(errorHandler(logger));
  return app;
}

/** In production the API also serves the built single-page app. */
function serveWebClient(app: Express, distDir: string | undefined, logger: Logger): void {
  if (!distDir) return;
  const root = path.resolve(distDir);
  const indexHtml = path.join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    logger.warn('Web client build not found; serving API only', { distDir: root });
    return;
  }
  app.use(express.static(root, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
}
