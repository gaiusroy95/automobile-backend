import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER_NAME = 'X-Request-Id';

/** Reuses an inbound `X-Request-Id` (e.g. from a gateway/load balancer) or mints a new one. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const id = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();

  req.id = id;
  res.setHeader(HEADER_NAME, id);
  next();
}
