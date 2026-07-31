import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const asyncHandler = (handler: AsyncRequestHandler): RequestHandler => {
  return (req, res, next) => {
    // Returning the promise is harmless for Express (it ignores middleware return values) and
    // lets tests `await` a wrapped handler directly instead of racing its internal async work.
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
};
