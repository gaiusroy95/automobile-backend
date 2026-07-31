import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from '../test-utils/fakeFirestore';
import { buildAutomobile } from '../test-utils/automobileFixture';
import { AutomobileService } from './automobile.service';
import type { Automobile } from '../models/automobile.model';

function seed(fake: FakeFirestore, cars: Record<string, Automobile>): void {
  fake.seed('automobiles', cars);
}

describe('AutomobileService', () => {
  let fake: FakeFirestore;
  let service: AutomobileService;

  beforeEach(() => {
    fake = new FakeFirestore();
    service = new AutomobileService(fake as unknown as Firestore);
  });

  describe('getAll', () => {
    it('returns cars ordered by name, paginated with a cursor', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'toyota corona' }),
        b: buildAutomobile({ name: 'honda civic' }),
        c: buildAutomobile({ name: 'mazda rx-2' }),
      });

      const page = await service.getAll({ limit: 2 });
      expect(page.data.map((car) => car.name)).toEqual(['honda civic', 'mazda rx-2']);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe('c');

      const nextPage = await service.getAll({ limit: 2, cursor: page.nextCursor ?? undefined });
      expect(nextPage.data.map((car) => car.name)).toEqual(['toyota corona']);
      expect(nextPage.hasMore).toBe(false);
      expect(nextPage.nextCursor).toBeNull();
    });

    it('clamps limit to the maximum page size (100)', async () => {
      const many: Record<string, Automobile> = {};
      for (let i = 0; i < 150; i += 1) {
        many[`id-${i}`] = buildAutomobile({ name: `car-${String(i).padStart(3, '0')}` });
      }
      seed(fake, many);

      const page = await service.getAll({ limit: 1000 });
      expect(page.data).toHaveLength(100);
      expect(page.hasMore).toBe(true);
    });
  });

  describe('getById', () => {
    it('returns the car when it exists', async () => {
      seed(fake, { id1: buildAutomobile({ name: 'toyota corona' }) });
      await expect(service.getById('id1')).resolves.toMatchObject({
        id: 'id1',
        name: 'toyota corona',
      });
    });

    it('returns null when the id does not exist', async () => {
      await expect(service.getById('nope')).resolves.toBeNull();
    });
  });

  describe('search', () => {
    it('matches a case-insensitive prefix on name', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'porsche 914-2' }),
        b: buildAutomobile({ name: 'peugeot 504' }),
        c: buildAutomobile({ name: 'toyota corona' }),
      });

      const page = await service.search('Po');
      expect(page.data.map((car) => car.name)).toEqual(['porsche 914-2']);
    });

    it('falls back to getAll for a blank term', async () => {
      seed(fake, { a: buildAutomobile({ name: 'toyota corona' }) });
      const page = await service.search('   ');
      expect(page.data.map((car) => car.name)).toEqual(['toyota corona']);
    });
  });

  describe('filter', () => {
    it('applies equality filters', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'toyota corona', origin: 'japan' }),
        b: buildAutomobile({ name: 'amc rebel sst', origin: 'usa' }),
      });

      const page = await service.filter({ origin: 'usa' });
      expect(page.data.map((car) => car.name)).toEqual(['amc rebel sst']);
    });

    it('applies an mpg range and orders by mpg', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'car-a', mpg: 10 }),
        b: buildAutomobile({ name: 'car-b', mpg: 20 }),
        c: buildAutomobile({ name: 'car-c', mpg: 30 }),
      });

      const page = await service.filter({ minMpg: 15, maxMpg: 25 });
      expect(page.data.map((car) => car.name)).toEqual(['car-b']);
    });

    it('does not force a default sort on an equality filter with no explicit sortBy', async () => {
      // Regression test: an earlier version always defaulted to `.orderBy('name')`, which
      // combined with any equality filter requires a Firestore composite index — every single
      // filter 500'd in production even though this fake (which doesn't enforce Firestore's
      // indexing rules) let the equivalent test pass. Seeded out of alphabetical order on
      // purpose and asserting the exact (unsorted) order: if a default sort ever creeps back
      // in, this comes back alphabetical ('amc rebel sst' first) instead of insertion order.
      seed(fake, {
        a: buildAutomobile({ name: 'zzz first inserted', origin: 'usa' }),
        b: buildAutomobile({ name: 'amc rebel sst', origin: 'usa' }),
      });

      const page = await service.filter({ origin: 'usa' });
      expect(page.data.map((car) => car.name)).toEqual(['zzz first inserted', 'amc rebel sst']);
    });

    it('still sorts a filtered query when sortBy is explicitly requested', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'toyota corona', origin: 'japan', horsepower: 200 }),
        b: buildAutomobile({ name: 'datsun pl510', origin: 'japan', horsepower: 100 }),
      });

      const page = await service.query({ origin: 'japan', sortBy: 'horsepower' });
      expect(page.data.map((car) => car.name)).toEqual(['datsun pl510', 'toyota corona']);
    });
  });

  describe('query', () => {
    it('combines a text search with equality filters', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'plymouth fury', origin: 'usa' }),
        b: buildAutomobile({ name: 'plymouth valiant', origin: 'usa' }),
        c: buildAutomobile({ name: 'peugeot 504', origin: 'europe' }),
      });

      const page = await service.query({ q: 'plymouth', origin: 'usa' });
      expect(page.data.map((car) => car.name)).toEqual(['plymouth fury', 'plymouth valiant']);
    });

    it('rejects combining a text search with an mpg range (400)', async () => {
      await expect(service.query({ q: 'a', minMpg: 20 })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('falls back to getAll when no params are given', async () => {
      seed(fake, { a: buildAutomobile({ name: 'toyota corona' }) });
      const page = await service.query({});
      expect(page.data.map((car) => car.name)).toEqual(['toyota corona']);
    });
  });

  describe('sorting', () => {
    it('getAll sorts by an arbitrary sortable field, ascending by default', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'car-a', weight: 3000 }),
        b: buildAutomobile({ name: 'car-b', weight: 2000 }),
        c: buildAutomobile({ name: 'car-c', weight: 2500 }),
      });

      const page = await service.getAll({}, { sortBy: 'weight' });
      expect(page.data.map((car) => car.weight)).toEqual([2000, 2500, 3000]);
    });

    it('honors sortOrder desc', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'car-a', mpg: 10 }),
        b: buildAutomobile({ name: 'car-b', mpg: 30 }),
        c: buildAutomobile({ name: 'car-c', mpg: 20 }),
      });

      const page = await service.getAll({}, { sortBy: 'mpg', sortOrder: 'desc' });
      expect(page.data.map((car) => car.mpg)).toEqual([30, 20, 10]);
    });

    it('allows sortBy=name when combined with a text search (matches the forced order field)', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'porsche 914-2' }),
        b: buildAutomobile({ name: 'peugeot 504' }),
      });

      const page = await service.query({ q: 'p', sortBy: 'name', sortOrder: 'desc' });
      expect(page.data.map((car) => car.name)).toEqual(['porsche 914-2', 'peugeot 504']);
    });

    it('rejects sortBy that conflicts with a text-search-forced order (400)', async () => {
      await expect(service.query({ q: 'a', sortBy: 'mpg' })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('rejects sortBy that conflicts with an mpg-range-forced order (400)', async () => {
      await expect(service.query({ minMpg: 10, sortBy: 'horsepower' })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('allows sortBy=mpg when combined with an mpg range (matches the forced order field)', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'car-a', mpg: 15 }),
        b: buildAutomobile({ name: 'car-b', mpg: 20 }),
      });

      const page = await service.query({ minMpg: 10, sortBy: 'mpg', sortOrder: 'desc' });
      expect(page.data.map((car) => car.mpg)).toEqual([20, 15]);
    });
  });

  describe('streamForExport', () => {
    it('streams every matching document as a plain {id, ...fields} object', async () => {
      seed(fake, {
        a: buildAutomobile({ name: 'toyota corona', origin: 'japan' }),
        b: buildAutomobile({ name: 'datsun pl510', origin: 'japan' }),
        c: buildAutomobile({ name: 'amc rebel sst', origin: 'usa' }),
      });

      const stream = service.streamForExport({ origin: 'japan' });
      const rows: Array<{ id: string; name: string }> = [];
      for await (const row of stream) {
        rows.push(row as { id: string; name: string });
      }

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.name).sort()).toEqual(['datsun pl510', 'toyota corona']);
      expect(rows.every((row) => typeof row.id === 'string')).toBe(true);
    });
  });
});
