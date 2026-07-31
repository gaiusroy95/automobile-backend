import compression from 'compression';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import { requestId } from './middleware/requestId';
import { router } from './routes';

morgan.token('id', (req: Request) => req.id ?? '-');

const MORGAN_FORMAT = config.isDevelopment
  ? ':id :method :url :status :response-time ms'
  : ':id :remote-addr :method :url :status :res[content-length] - :response-time ms';

export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(compression());

  // Bare liveness endpoint for Render's health check / container orchestrators. Deliberately
  // registered before requestId/morgan/body-parsing so it stays dependency-free and doesn't
  // flood the logs with a line for every health-check ping (these can fire every few seconds).
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(requestId);

  if (!config.isTest) {
    app.use(morgan(MORGAN_FORMAT));
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
