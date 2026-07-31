import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../utils/ApiError';

const HEADER_NAME = 'x-admin-key';

/**
 * Gates write endpoints behind a single shared secret (`ADMIN_API_KEY`). There's no user-account
 * system in this app — this is a deliberately lightweight check for a single-operator tool, not
 * a substitute for real authentication/authorization.
 */
export function requireAdminKey(req: Request, _res: Response, next: NextFunction): void {
  const provided = req.headers[HEADER_NAME];

  if (provided !== config.adminApiKey) {
    next(new ApiError(401, 'Missing or incorrect admin key.'));
    return;
  }

  next();
}
