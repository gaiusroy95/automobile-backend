import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from './validate';

function mockReq(overrides: Partial<Request> = {}): Request {
  return { params: {}, query: {}, body: {}, ...overrides } as unknown as Request;
}

describe('validate', () => {
  const next = jest.fn() as unknown as NextFunction;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('parses matching schemas and stores the result on req.validated', () => {
    const middleware = validate({
      query: z.object({ limit: z.coerce.number().int().optional() }),
      params: z.object({ id: z.string().min(1) }),
    });

    const req = mockReq({ query: { limit: '5' }, params: { id: 'abc' } });

    middleware(req, {} as Response, next);

    expect(req.validated).toEqual({ query: { limit: 5 }, params: { id: 'abc' } });
    expect(next).toHaveBeenCalledWith();
  });

  it('only validates the schemas that were provided', () => {
    const middleware = validate({ query: z.object({ q: z.string().optional() }) });
    const req = mockReq({ query: { q: 'toyota' }, params: { id: 'unchecked' } });

    middleware(req, {} as Response, next);

    expect(req.validated).toEqual({ query: { q: 'toyota' } });
    expect(next).toHaveBeenCalledWith();
  });

  it('forwards a ZodError to next() on validation failure instead of throwing', () => {
    const middleware = validate({ params: z.object({ id: z.string().min(1) }) });
    const req = mockReq({ params: { id: '' } });

    middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ZodError');
    expect(req.validated).toBeUndefined();
  });
});
