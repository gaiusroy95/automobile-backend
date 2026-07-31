import { PassThrough, Readable } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { buildAutomobile } from '../test-utils/automobileFixture';

jest.mock('../services/automobile.service', () => ({
  automobileService: {
    getAll: jest.fn(),
    getById: jest.fn(),
    query: jest.fn(),
    filter: jest.fn(),
    search: jest.fn(),
    streamForExport: jest.fn(),
    create: jest.fn(),
  },
}));

import {
  createAutomobile,
  exportAutomobiles,
  getAutomobileById,
  listAutomobiles,
  searchAutomobiles,
} from './automobile.controller';
import { automobileService } from '../services/automobile.service';

// Controllers no longer parse req.query/req.params themselves — the `validate()` middleware
// (tested separately) does that upstream and stores the result on req.validated. So these tests
// build req.validated directly, as if validation already ran.
function mockReq(validated: Request['validated'] = {}): Request {
  return { validated } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
}

const next = jest.fn() as unknown as NextFunction;

describe('automobile.controller', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listAutomobiles', () => {
    it('splits pagination from q/filters/sort and delegates to service.query', async () => {
      const result = { data: [{ id: '1', ...buildAutomobile() }], nextCursor: null, hasMore: false };
      (automobileService.query as jest.Mock).mockResolvedValue(result);

      const req = mockReq({
        query: {
          limit: 10,
          cursor: 'abc',
          origin: 'usa',
          sortBy: 'mpg',
          sortOrder: 'desc',
        },
      });
      const res = mockRes();

      await listAutomobiles(req, res, next);

      expect(automobileService.query).toHaveBeenCalledWith(
        { origin: 'usa', sortBy: 'mpg', sortOrder: 'desc' },
        { limit: 10, cursor: 'abc' },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
    });
  });

  describe('getAutomobileById', () => {
    it('returns the envelope with the automobile when found', async () => {
      const automobile = { id: 'abc123', ...buildAutomobile() };
      (automobileService.getById as jest.Mock).mockResolvedValue(automobile);

      const req = mockReq({ params: { id: 'abc123' } });
      const res = mockRes();

      await getAutomobileById(req, res, next);

      expect(automobileService.getById).toHaveBeenCalledWith('abc123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: automobile });
    });

    it('forwards a 404 ApiError to next() when the service returns null', async () => {
      (automobileService.getById as jest.Mock).mockResolvedValue(null);

      const req = mockReq({ params: { id: 'missing' } });
      const res = mockRes();

      await getAutomobileById(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const err = (next as jest.Mock).mock.calls[0][0] as ApiError;
      expect(err.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('searchAutomobiles', () => {
    it('is the same handler as listAutomobiles (an alias, not separate logic)', () => {
      expect(searchAutomobiles).toBe(listAutomobiles);
    });

    it('splits pagination from q + filters and delegates to service.query', async () => {
      const result = { data: [], nextCursor: null, hasMore: false };
      (automobileService.query as jest.Mock).mockResolvedValue(result);

      const req = mockReq({ query: { q: 'toy', origin: 'japan', limit: 5 } });
      const res = mockRes();

      await searchAutomobiles(req, res, next);

      expect(automobileService.query).toHaveBeenCalledWith(
        { q: 'toy', origin: 'japan' },
        { limit: 5, cursor: undefined },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
    });

    it('forwards a service-thrown ApiError (e.g. q + mpg range) to next()', async () => {
      (automobileService.query as jest.Mock).mockRejectedValue(new ApiError(400, 'conflict'));

      const req = mockReq({ query: { q: 'a', minMpg: 20 } });
      const res = mockRes();

      await searchAutomobiles(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    });
  });

  describe('createAutomobile', () => {
    it('creates the record and responds 201 with the id attached', async () => {
      const input = buildAutomobile({ name: 'toyota corona' });
      (automobileService.create as jest.Mock).mockResolvedValue('new-id-1');

      const req = mockReq({ body: input });
      const res = mockRes();

      await createAutomobile(req, res, next);

      expect(automobileService.create).toHaveBeenCalledWith(input);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { id: 'new-id-1', ...input },
      });
    });
  });

  describe('exportAutomobiles', () => {
    it('sets CSV response headers and streams service rows through as CSV', async () => {
      const rows = Readable.from([{ id: '1', name: 'toyota corona' }], { objectMode: true });
      (automobileService.streamForExport as jest.Mock).mockReturnValue(rows);

      const req = mockReq({ query: { origin: 'japan' } });
      const passthrough = new PassThrough();
      const setHeader = jest.fn();
      const res = Object.assign(passthrough, { setHeader }) as unknown as Response;

      const chunks: Buffer[] = [];
      passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      await exportAutomobiles(req, res, next);

      expect(automobileService.streamForExport).toHaveBeenCalledWith({ origin: 'japan' });
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="automobiles.csv"',
      );

      const csv = Buffer.concat(chunks).toString();
      expect(csv).toContain('name');
      expect(csv).toContain('toyota corona');
    });
  });
});
