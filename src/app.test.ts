import { Readable } from 'node:stream';
import request from 'supertest';
import { ApiError } from './utils/ApiError';
import { buildAutomobile } from './test-utils/automobileFixture';

jest.mock('./services/automobile.service', () => ({
  automobileService: {
    getAll: jest.fn(),
    getById: jest.fn(),
    query: jest.fn(),
    filter: jest.fn(),
    search: jest.fn(),
    streamForExport: jest.fn(),
  },
}));

import { createApp } from './app';
import { automobileService } from './services/automobile.service';

const app = createApp();

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /health', () => {
  it('returns exactly { status: "ok" } for the platform health check, with no envelope', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('bypasses requestId (mounted before it) so health-check pings stay unlogged/untagged', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeUndefined();
  });
});

describe('GET /api/health', () => {
  it('returns process status wrapped in the success envelope', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'ok' });
    expect(typeof res.body.data.uptime).toBe('number');
  });
});

describe('request id correlation', () => {
  it('mints an X-Request-Id header when the client sends none', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('echoes back a client-supplied X-Request-Id', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'test-request-id');
    expect(res.headers['x-request-id']).toBe('test-request-id');
  });

  it('includes the request id in error responses for correlation', async () => {
    const res = await request(app)
      .get('/api/cars/search')
      .set('X-Request-Id', 'test-request-id')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.error.requestId).toBe('test-request-id');
  });
});

describe('GET /api/cars', () => {
  it('returns a paginated list wrapped in the success envelope', async () => {
    const page = { data: [{ id: '1', ...buildAutomobile() }], nextCursor: null, hasMore: false };
    (automobileService.query as jest.Mock).mockResolvedValue(page);

    const res = await request(app).get('/api/cars').query({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: page });
    expect(automobileService.query).toHaveBeenCalledWith(
      { sortBy: undefined, sortOrder: undefined },
      { limit: 5, cursor: undefined },
    );
  });

  it('supports q, filters, and sortBy/sortOrder directly on /cars (no separate /search needed)', async () => {
    const page = { data: [], nextCursor: null, hasMore: false };
    (automobileService.query as jest.Mock).mockResolvedValue(page);

    await request(app)
      .get('/api/cars')
      .query({ q: 'toy', fuelType: 'gas', sortBy: 'price', sortOrder: 'desc' });

    expect(automobileService.query).toHaveBeenCalledWith(
      { q: 'toy', fuelType: 'gas', sortBy: 'price', sortOrder: 'desc' },
      { limit: undefined, cursor: undefined },
    );
  });

  it('returns 400 for an invalid sortBy value', async () => {
    const res = await request(app).get('/api/cars').query({ sortBy: 'not-a-field' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/cars/:id', () => {
  it('returns 200 with the automobile wrapped in the success envelope', async () => {
    const automobile = { id: 'abc123', ...buildAutomobile() };
    (automobileService.getById as jest.Mock).mockResolvedValue(automobile);

    const res = await request(app).get('/api/cars/abc123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: automobile });
  });

  it('returns a 404 error envelope when not found', async () => {
    (automobileService.getById as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get('/api/cars/missing');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/not found/i);
  });
});

describe('GET /api/cars/search', () => {
  it('delegates q + structured filters to automobileService.query', async () => {
    const page = { data: [], nextCursor: null, hasMore: false };
    (automobileService.query as jest.Mock).mockResolvedValue(page);

    const res = await request(app).get('/api/cars/search').query({ q: 'toy', fuelType: 'gas' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: page });
    expect(automobileService.query).toHaveBeenCalledWith(
      { q: 'toy', fuelType: 'gas' },
      { limit: undefined, cursor: undefined },
    );
  });

  it('returns 400 for an invalid query param instead of a raw 500', async () => {
    const res = await request(app).get('/api/cars/search').query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Validation failed');
    expect(automobileService.query).not.toHaveBeenCalled();
  });

  it('returns 400 when the service rejects a q + price-range combination', async () => {
    (automobileService.query as jest.Mock).mockRejectedValue(
      new ApiError(400, 'Cannot combine a text search (q) with a price range filter'),
    );

    const res = await request(app).get('/api/cars/search').query({ q: 'a', minPrice: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/price range/);
  });
});

describe('GET /api/cars/export', () => {
  it('streams a CSV file with the expected headers and content', async () => {
    const rows = Readable.from(
      [
        { id: '1', make: 'toyota' },
        { id: '2', make: 'honda' },
      ],
      { objectMode: true },
    );
    (automobileService.streamForExport as jest.Mock).mockReturnValue(rows);

    const res = await request(app).get('/api/cars/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="automobiles.csv"');
    expect(res.text).toContain('toyota');
    expect(res.text).toContain('honda');
  });
});

describe('POST with malformed JSON body', () => {
  it('returns a 400 error envelope instead of a raw 500', async () => {
    const res = await request(app)
      .post('/api/cars/search')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/malformed json/i);
  });
});

describe('unmatched routes', () => {
  it('returns a 404 error envelope for a route that does not exist', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/route not found/i);
  });
});
