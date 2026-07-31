import type { NextFunction, Request, Response } from 'express';
import { requestId } from './requestId';

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requestId', () => {
  const next = jest.fn() as unknown as NextFunction;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('mints a new id when the client sends none', () => {
    const req = { headers: {} } as unknown as Request;
    const res = mockRes();

    requestId(req, res, next);

    expect(typeof req.id).toBe('string');
    expect(req.id.length).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalledWith();
  });

  it('reuses an inbound X-Request-Id header', () => {
    const req = { headers: { 'x-request-id': 'client-supplied-id' } } as unknown as Request;
    const res = mockRes();

    requestId(req, res, next);

    expect(req.id).toBe('client-supplied-id');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-supplied-id');
  });

  it('takes the first value when the header is sent multiple times', () => {
    const req = { headers: { 'x-request-id': ['first-id', 'second-id'] } } as unknown as Request;
    const res = mockRes();

    requestId(req, res, next);

    expect(req.id).toBe('first-id');
  });
});
