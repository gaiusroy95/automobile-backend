import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

/** Express's own documented heuristic for `express.json()`'s malformed-body SyntaxError. */
function isMalformedJsonError(err: unknown): err is SyntaxError {
  return err instanceof SyntaxError && 'body' in err;
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // e.g. a streaming CSV export that failed partway through: the response body has
    // already started, so delegate to Express's default handler to close the connection.
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        requestId: req.id,
        issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }

  if (isMalformedJsonError(err)) {
    res.status(400).json({
      success: false,
      error: { message: 'Malformed JSON in request body', requestId: req.id },
    });
    return;
  }

  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';

  if (!isApiError || !err.isOperational) {
    logger.error('Unhandled request error', {
      requestId: req.id,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      requestId: req.id,
      ...(config.isDevelopment && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
