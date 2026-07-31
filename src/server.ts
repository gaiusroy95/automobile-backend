import type { Server } from 'http';
import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server: Server = app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port} [${config.env}]`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received: closing server gracefully`);
  server.close((err) => {
    if (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
