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
    it('returns cars ordered by make, paginated with a cursor', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'toyota' }),
        b: buildAutomobile({ make: 'honda' }),
        c: buildAutomobile({ make: 'mazda' }),
      });

      const page = await service.getAll({ limit: 2 });
      expect(page.data.map((car) => car.make)).toEqual(['honda', 'mazda']);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe('c');

      const nextPage = await service.getAll({ limit: 2, cursor: page.nextCursor ?? undefined });
      expect(nextPage.data.map((car) => car.make)).toEqual(['toyota']);
      expect(nextPage.hasMore).toBe(false);
      expect(nextPage.nextCursor).toBeNull();
    });

    it('clamps limit to the maximum page size (100)', async () => {
      const many: Record<string, Automobile> = {};
      for (let i = 0; i < 150; i += 1) {
        many[`id-${i}`] = buildAutomobile({ make: `make-${String(i).padStart(3, '0')}` });
      }
      seed(fake, many);

      const page = await service.getAll({ limit: 1000 });
      expect(page.data).toHaveLength(100);
      expect(page.hasMore).toBe(true);
    });
  });

  describe('getById', () => {
    it('returns the car when it exists', async () => {
      seed(fake, { id1: buildAutomobile({ make: 'toyota' }) });
      await expect(service.getById('id1')).resolves.toMatchObject({ id: 'id1', make: 'toyota' });
    });

    it('returns null when the id does not exist', async () => {
      await expect(service.getById('nope')).resolves.toBeNull();
    });
  });

  describe('search', () => {
    it('matches a case-insensitive prefix on make', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'porsche' }),
        b: buildAutomobile({ make: 'peugeot' }),
        c: buildAutomobile({ make: 'toyota' }),
      });

      const page = await service.search('Po');
      expect(page.data.map((car) => car.make)).toEqual(['porsche']);
    });

    it('falls back to getAll for a blank term', async () => {
      seed(fake, { a: buildAutomobile({ make: 'toyota' }) });
      const page = await service.search('   ');
      expect(page.data.map((car) => car.make)).toEqual(['toyota']);
    });
  });

  describe('filter', () => {
    it('applies equality filters', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'toyota', fuelType: 'gas' }),
        b: buildAutomobile({ make: 'audi', fuelType: 'diesel' }),
      });

      const page = await service.filter({ fuelType: 'diesel' });
      expect(page.data.map((car) => car.make)).toEqual(['audi']);
    });

    it('applies a price range and orders by price', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'a-brand', price: 10000 }),
        b: buildAutomobile({ make: 'b-brand', price: 20000 }),
        c: buildAutomobile({ make: 'c-brand', price: 30000 }),
      });

      const page = await service.filter({ minPrice: 15000, maxPrice: 25000 });
      expect(page.data.map((car) => car.make)).toEqual(['b-brand']);
    });
  });

  describe('query', () => {
    it('combines a text search with equality filters', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'porsche', fuelType: 'gas' }),
        b: buildAutomobile({ make: 'peugeot', fuelType: 'diesel' }),
        c: buildAutomobile({ make: 'polestar', fuelType: 'diesel' }),
      });

      const page = await service.query({ q: 'p', fuelType: 'gas' });
      expect(page.data.map((car) => car.make)).toEqual(['porsche']);
    });

    it('rejects combining a text search with a price range (400)', async () => {
      await expect(service.query({ q: 'a', minPrice: 100 })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('falls back to getAll when no params are given', async () => {
      seed(fake, { a: buildAutomobile({ make: 'toyota' }) });
      const page = await service.query({});
      expect(page.data.map((car) => car.make)).toEqual(['toyota']);
    });
  });

  describe('sorting', () => {
    it('getAll sorts by an arbitrary sortable field, ascending by default', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'a-brand', horsepower: 200 }),
        b: buildAutomobile({ make: 'b-brand', horsepower: 100 }),
        c: buildAutomobile({ make: 'c-brand', horsepower: 150 }),
      });

      const page = await service.getAll({}, { sortBy: 'horsepower' });
      expect(page.data.map((car) => car.horsepower)).toEqual([100, 150, 200]);
    });

    it('honors sortOrder desc', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'a-brand', price: 10000 }),
        b: buildAutomobile({ make: 'b-brand', price: 30000 }),
        c: buildAutomobile({ make: 'c-brand', price: 20000 }),
      });

      const page = await service.getAll({}, { sortBy: 'price', sortOrder: 'desc' });
      expect(page.data.map((car) => car.price)).toEqual([30000, 20000, 10000]);
    });

    it('applies sortBy alongside equality filters via query()', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'toyota', fuelType: 'gas', cityMpg: 20 }),
        b: buildAutomobile({ make: 'honda', fuelType: 'gas', cityMpg: 30 }),
        c: buildAutomobile({ make: 'audi', fuelType: 'diesel', cityMpg: 25 }),
      });

      const page = await service.query({ fuelType: 'gas', sortBy: 'cityMpg' });
      expect(page.data.map((car) => car.make)).toEqual(['toyota', 'honda']);
    });

    it('allows sortBy=make when combined with a text search (matches the forced order field)', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'porsche' }),
        b: buildAutomobile({ make: 'peugeot' }),
      });

      const page = await service.query({ q: 'p', sortBy: 'make', sortOrder: 'desc' });
      expect(page.data.map((car) => car.make)).toEqual(['porsche', 'peugeot']);
    });

    it('rejects sortBy that conflicts with a text-search-forced order (400)', async () => {
      await expect(service.query({ q: 'a', sortBy: 'price' })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('rejects sortBy that conflicts with a price-range-forced order (400)', async () => {
      await expect(
        service.query({ minPrice: 1000, sortBy: 'horsepower' }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('allows sortBy=price when combined with a price range (matches the forced order field)', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'a-brand', price: 15000 }),
        b: buildAutomobile({ make: 'b-brand', price: 20000 }),
      });

      const page = await service.query({ minPrice: 10000, sortBy: 'price', sortOrder: 'desc' });
      expect(page.data.map((car) => car.price)).toEqual([20000, 15000]);
    });
  });

  describe('streamForExport', () => {
    it('streams every matching document as a plain {id, ...fields} object', async () => {
      seed(fake, {
        a: buildAutomobile({ make: 'toyota', fuelType: 'gas' }),
        b: buildAutomobile({ make: 'honda', fuelType: 'gas' }),
        c: buildAutomobile({ make: 'audi', fuelType: 'diesel' }),
      });

      const stream = service.streamForExport({ fuelType: 'gas' });
      const rows: Array<{ id: string; make: string }> = [];
      for await (const row of stream) {
        rows.push(row as { id: string; make: string });
      }

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.make).sort()).toEqual(['honda', 'toyota']);
      expect(rows.every((row) => typeof row.id === 'string')).toBe(true);
    });
  });
});
