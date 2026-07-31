import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { requireAdminKey } from './requireAdminKey';

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe('requireAdminKey', () => {
  const next = jest.fn() as unknown as NextFunction;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() with no error when the header matches ADMIN_API_KEY', () => {
    const req = mockReq({ 'x-admin-key': process.env.ADMIN_API_KEY as string });

    requireAdminKey(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('forwards a 401 ApiError when the header is missing', () => {
    const req = mockReq({});

    requireAdminKey(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    const err = (next as jest.Mock).mock.calls[0][0] as ApiError;
    expect(err.statusCode).toBe(401);
  });

  it('forwards a 401 ApiError when the header value is wrong', () => {
    const req = mockReq({ 'x-admin-key': 'definitely-not-the-key' });

    requireAdminKey(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    const err = (next as jest.Mock).mock.calls[0][0] as ApiError;
    expect(err.statusCode).toBe(401);
  });
});
