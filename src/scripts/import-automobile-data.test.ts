import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from '../test-utils/fakeFirestore';
import {
  parseArgs,
  rowSchema,
  run,
  toFirestoreDoc,
  toNullableNumber,
  toNullableString,
  toNullableWordNumber,
} from './import-automobile-data';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const validRawRow = {
  symboling: '3',
  'normalized-losses': '?',
  make: 'toyota',
  'fuel-type': 'gas',
  aspiration: 'std',
  'num-of-doors': 'four',
  'body-style': 'sedan',
  'drive-wheels': 'fwd',
  'engine-location': 'front',
  'wheel-base': '95',
  length: '170',
  width: '65',
  height: '55',
  'curb-weight': '2200',
  'engine-type': 'ohc',
  'num-of-cylinders': 'four',
  'engine-size': '120',
  'fuel-system': 'mpfi',
  bore: '3.2',
  stroke: '3.1',
  'compression-ratio': '9.5',
  horsepower: '100',
  'peak-rpm': '5000',
  'city-mpg': '25',
  'highway-mpg': '30',
  price: '?',
};

describe('toNullableString', () => {
  it('treats blank and "?" as missing', () => {
    expect(toNullableString('')).toBeNull();
    expect(toNullableString('   ')).toBeNull();
    expect(toNullableString('?')).toBeNull();
  });

  it('trims and returns a real value', () => {
    expect(toNullableString('  toyota  ')).toBe('toyota');
  });

  it('returns null for non-string input', () => {
    expect(toNullableString(undefined)).toBeNull();
  });
});

describe('toNullableNumber', () => {
  it('converts a numeric string', () => {
    expect(toNullableNumber('123.5')).toBe(123.5);
  });

  it('returns null for missing values', () => {
    expect(toNullableNumber('?')).toBeNull();
  });

  it('returns NaN for a non-numeric, non-missing value (caught later by zod)', () => {
    expect(Number.isNaN(toNullableNumber('abc'))).toBe(true);
  });
});

describe('toNullableWordNumber', () => {
  it('converts known number words, case-insensitively', () => {
    expect(toNullableWordNumber('four')).toBe(4);
    expect(toNullableWordNumber('Six')).toBe(6);
  });

  it('returns null for missing values', () => {
    expect(toNullableWordNumber('?')).toBeNull();
  });

  it('returns NaN for an unrecognized word', () => {
    expect(Number.isNaN(toNullableWordNumber('seven'))).toBe(true);
  });
});

describe('rowSchema', () => {
  it('parses a valid row, converting "?" cells to null and words to numbers', () => {
    const result = rowSchema.safeParse(validRawRow);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data['normalized-losses']).toBeNull();
      expect(result.data.price).toBeNull();
      expect(result.data['num-of-doors']).toBe(4);
      expect(result.data['num-of-cylinders']).toBe(4);
      expect(result.data.symboling).toBe(3);
    }
  });

  it('rejects an invalid enum value', () => {
    const result = rowSchema.safeParse({ ...validRawRow, 'fuel-type': 'petrol' });
    expect(result.success).toBe(false);
  });

  it('rejects symboling outside the -3..3 range', () => {
    const result = rowSchema.safeParse({ ...validRawRow, symboling: '10' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field (make)', () => {
    const result = rowSchema.safeParse({ ...validRawRow, make: '?' });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized num-of-doors word', () => {
    const result = rowSchema.safeParse({ ...validRawRow, 'num-of-doors': 'six' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric value in a numeric column', () => {
    const result = rowSchema.safeParse({ ...validRawRow, horsepower: 'abc' });
    expect(result.success).toBe(false);
  });
});

describe('toFirestoreDoc', () => {
  it('maps a validated row to the camelCase Automobile shape', () => {
    const validated = rowSchema.parse(validRawRow);
    const doc = toFirestoreDoc(validated);

    expect(doc).toMatchObject({
      symboling: 3,
      normalizedLosses: null,
      make: 'toyota',
      fuelType: 'gas',
      numOfDoors: 4,
      numOfCylinders: 4,
      price: null,
    });
  });
});

describe('parseArgs', () => {
  it('applies defaults when no flags are given', () => {
    const options = parseArgs([]);
    expect(options.collectionName).toBe('automobiles');
    expect(options.batchSize).toBe(500);
    expect(options.dryRun).toBe(false);
    expect(options.filePath.replace(/\\/g, '/')).toMatch(/data\/automobile\.csv$/);
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

  const header =
    'symboling,normalized-losses,make,fuel-type,aspiration,num-of-doors,body-style,drive-wheels,' +
    'engine-location,wheel-base,length,width,height,curb-weight,engine-type,num-of-cylinders,' +
    'engine-size,fuel-system,bore,stroke,compression-ratio,horsepower,peak-rpm,city-mpg,highway-mpg,price';

  // Row 3 (petrol) and row 4 (horsepower "abc") are intentionally invalid.
  const rows = [
    '3,150,toyota,gas,std,four,sedan,fwd,front,95,170,65,55,2200,ohc,four,120,mpfi,3.2,3.1,9.5,100,5000,25,30,15000',
    '1,?,honda,gas,std,two,hatchback,fwd,front,93,160,64,54,2100,ohc,four,110,2bbl,3.0,3.0,9.0,90,5200,28,33,?',
    '0,120,ford,petrol,std,four,sedan,rwd,front,100,180,66,56,2400,ohc,four,130,mpfi,3.3,3.2,9.2,105,5100,24,28,16000',
    '2,130,mazda,gas,turbo,two,hatchback,fwd,front,94,165,64,53,2050,ohc,four,115,mpfi,3.1,3.0,8.8,abc,5300,27,32,14000',
    '-1,140,subaru,gas,std,four,wagon,4wd,front,99,175,68,58,2600,ohc,four,140,mpfi,3.4,3.3,9.8,110,5000,22,27,17500',
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
    expect(stored.map((doc) => doc.make).sort()).toEqual(['honda', 'subaru', 'toyota']);
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
