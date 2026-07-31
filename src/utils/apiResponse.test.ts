import type { Response } from 'express';
import { sendSuccess } from './apiResponse';

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('sendSuccess', () => {
  it('defaults to a 200 with the success envelope', () => {
    const res = mockRes();

    sendSuccess(res, { foo: 'bar' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { foo: 'bar' } });
  });

  it('accepts a custom status code', () => {
    const res = mockRes();

    sendSuccess(res, { id: '1' }, 201);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: '1' } });
  });
});
