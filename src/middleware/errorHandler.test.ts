import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/ApiError';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { errorHandler } from './errorHandler';

function mockReq(overrides: Partial<Request> = {}): Request {
  return { id: 'req-1', ...overrides } as unknown as Request;
}

function mockRes(overrides: Partial<Response> = {}): Response {
  const res: Partial<Response> = { headersSent: false, ...overrides };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('errorHandler', () => {
  const next = jest.fn() as unknown as NextFunction;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps an ApiError to its own status code', () => {
    const req = mockReq();
    const res = mockRes();

    errorHandler(new ApiError(404, 'Not found'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { message: 'Not found', requestId: 'req-1' },
    });
  });

  it('maps a ZodError to a 400 with per-field issues', () => {
    const req = mockReq();
    const res = mockRes();
    const result = z.object({ id: z.string().min(1) }).safeParse({ id: '' });

    errorHandler(result.success ? undefined : result.error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.message).toBe('Validation failed');
    expect(payload.error.requestId).toBe('req-1');
    expect(payload.error.issues[0]).toMatchObject({ path: 'id' });
  });

  it('maps a body-parser malformed-JSON SyntaxError to a 400', () => {
    const req = mockReq();
    const res = mockRes();
    const malformed = new SyntaxError('Unexpected token') as SyntaxError & { body: string };
    malformed.body = '{bad';

    errorHandler(malformed, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { message: 'Malformed JSON in request body', requestId: 'req-1' },
    });
  });

  it('falls back to 500 for an unrecognized error', () => {
    const req = mockReq();
    const res = mockRes();

    errorHandler(new Error('boom'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.message).toBe('boom');
    expect(payload.error.requestId).toBe('req-1');
  });

  it('delegates to next() instead of writing a response once headers are already sent', () => {
    const req = mockReq();
    const res = mockRes({ headersSent: true });

    errorHandler(new Error('too late'), req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
