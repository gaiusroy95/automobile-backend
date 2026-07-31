import type { Response } from 'express';

/** Every successful JSON response in the API shares this envelope: `{ success: true, data }`. */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data });
}
