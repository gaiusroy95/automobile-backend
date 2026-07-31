type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (meta !== undefined) {
    method(line, meta);
  } else {
    method(line);
  }
}

export const logger = {
  info: (message: string, meta?: unknown): void => write('info', message, meta),
  warn: (message: string, meta?: unknown): void => write('warn', message, meta),
  error: (message: string, meta?: unknown): void => write('error', message, meta),
};
