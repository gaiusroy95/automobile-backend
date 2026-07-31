import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export interface ValidationSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

/**
 * Validates `req.params`/`req.query`/`req.body` against the given Zod schemas and stores the
 * parsed (type-coerced) result on `req.validated`, so controllers never touch raw Express input
 * or call `.parse()` themselves. On failure, forwards the `ZodError` to the centralized error
 * handler, which maps it to a 400.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated: Request['validated'] = {};
      if (schemas.params) validated.params = schemas.params.parse(req.params);
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.body) validated.body = schemas.body.parse(req.body);
      req.validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}
