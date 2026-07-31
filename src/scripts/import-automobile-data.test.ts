import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from '../test-utils/fakeFirestore';
import { parseArgs, rowSchema, run, toFirestoreDoc, toNullableNumber, toNullableString } from './import-automobile-data';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const validRawRow = {
  name: 'chevrolet chevelle malibu',
  mpg: '18',
  cylinders: '8',
  displacement: '307',
  horsepower: '130',
  weight: '3504',
  acceleration: '12',
  model_year: '70',
  origin: 'usa',
};

describe('toNullableString', () => {
  it('treats blank and "?" as missing', () => {
    expect(toNullableString('')).toBeNull();
    expect(toNullableString('   ')).toBeNull();
    expect(toNullableString('?')).toBeNull();
  });

  it('trims and returns a real value', () => {
    expect(toNullableString('  chevrolet  ')).toBe('chevrolet');
  });

  it('returns null for non-string input', () => {
    expect(toNullableString(undefined)).toBeNull();
  });
});

describe('toNullableNumber', () => {
  it('converts a numeric string', () => {
    expect(toNullableNumber('123.5')).toBe(123.5);
  });

  it('returns null for a blank (missing) value', () => {
    expect(toNullableNumber('')).toBeNull();
  });

  it('returns NaN for a non-numeric, non-missing value (caught later by zod)', () => {
    expect(Number.isNaN(toNullableNumber('abc'))).toBe(true);
  });
});

describe('rowSchema', () => {
  it('parses a valid row, converting types appropriately', () => {
    const result = rowSchema.safeParse(validRawRow);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('chevrolet chevelle malibu');
      expect(result.data.mpg).toBe(18);
      expect(result.data.cylinders).toBe(8);
      expect(result.data.model_year).toBe(70);
      expect(result.data.origin).toBe('usa');
    }
  });

  it('treats a blank horsepower cell as null (the dataset\'s actual missing-value convention)', () => {
    const result = rowSchema.safeParse({ ...validRawRow, horsepower: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.horsepower).toBeNull();
    }
  });

  it('rejects an invalid origin value', () => {
    const result = rowSchema.safeParse({ ...validRawRow, origin: 'germany' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field (name)', () => {
    const result = rowSchema.safeParse({ ...validRawRow, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric value in a numeric column', () => {
    const result = rowSchema.safeParse({ ...validRawRow, mpg: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive cylinders value', () => {
    const result = rowSchema.safeParse({ ...validRawRow, cylinders: '0' });
    expect(result.success).toBe(false);
  });
});

describe('toFirestoreDoc', () => {
  it('maps a validated row to the Automobile shape, expanding the 2-digit year to a full year', () => {
    const validated = rowSchema.parse(validRawRow);
    const doc = toFirestoreDoc(validated);

    expect(doc).toEqual({
      name: 'chevrolet chevelle malibu',
      mpg: 18,
      cylinders: 8,
      displacement: 307,
      horsepower: 130,
      weight: 3504,
      acceleration: 12,
      modelYear: 1970,
      origin: 'usa',
    });
  });

  it('preserves a null horsepower', () => {
    const validated = rowSchema.parse({ ...validRawRow, horsepower: '' });
    expect(toFirestoreDoc(validated).horsepower).toBeNull();
  });
});

describe('parseArgs', () => {
  it('applies defaults when no flags are given', () => {
    const options = parseArgs([]);
    expect(options.collectionName).toBe('automobiles');
    expect(options.batchSize).toBe(500);
    expect(options.dryRun).toBe(false);
    expect(options.filePath.replace(/\\/g, '/')).toMatch(/data\/Automobile\.csv$/);
  });

  it('overrides file, collection, batch-size, and dry-run from flags', () => {
    const options = parseArgs([
      '--file=foo.csv',
      '--collection=cars',
      '--batch-size=10',
      '--dry-run',
    ]);
    expect(options.filePath.replace(/\\/g, '/')).toMatch(/foo\.csv$/);
    expect(options.collectionName).toBe('cars');
    expect(options.batchSize).toBe(10);
    expect(options.dryRun).toBe(true);
  });

  it('clamps an oversized --batch-size to the Firestore limit (500)', () => {
    expect(parseArgs(['--batch-size=10000']).batchSize).toBe(500);
  });
});

describe('run', () => {
  let tmpDir: string;
  let csvPath: string;

  const header = 'name,mpg,cylinders,displacement,horsepower,weight,acceleration,model_year,origin';

  // Row 3 (invalid origin) and row 4 (non-numeric mpg) are intentionally invalid.
  const rows = [
    'chevrolet chevelle malibu,18,8,307,130,3504,12,70,usa',
    'amc rebel sst,16,8,304,,3433,12,70,usa',
    'toyota corona,24,4,113,95,2372,15,70,germany',
    'mazda rx2 coupe,abc,3,70,97,2330,13.5,72,japan',
    'volkswagen 1131 deluxe sedan,26,4,97,46,1835,20.5,70,europe',
  ];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'automobile-import-test-'));
    csvPath = join(tmpDir, 'sample.csv');
    writeFileSync(csvPath, [header, ...rows].join('\n'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports valid rows in batches and skips invalid ones', async () => {
    const fake = new FakeFirestore();

    const summary = await run(fake as unknown as Firestore, [`--file=${csvPath}`, '--batch-size=2']);

    expect(summary).toEqual({ totalRows: 5, imported: 3, skipped: 2 });

    const stored = fake.dump('automobiles');
    expect(stored).toHaveLength(3);
    expect(stored.map((doc) => doc.name).sort()).toEqual([
      'amc rebel sst',
      'chevrolet chevelle malibu',
      'volkswagen 1131 deluxe sedan',
    ]);
  });

  it('writes nothing in --dry-run mode but still reports an accurate summary', async () => {
    const fake = new FakeFirestore();

    const summary = await run(fake as unknown as Firestore, [`--file=${csvPath}`, '--dry-run']);

    expect(summary).toEqual({ totalRows: 5, imported: 3, skipped: 2 });
    expect(fake.dump('automobiles')).toHaveLength(0);
  });

  it('writes to the collection named by --collection', async () => {
    const fake = new FakeFirestore();

    await run(fake as unknown as Firestore, [`--file=${csvPath}`, '--collection=cars']);

    expect(fake.dump('cars')).toHaveLength(3);
    expect(fake.dump('automobiles')).toHaveLength(0);
  });
});
