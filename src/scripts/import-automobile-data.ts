/**
 * Imports the automobile dataset (classic UCI "imports-85" schema) from a CSV file into
 * Firestore. Run with `npm run import:automobile -- --file=data/automobile.csv`.
 *
 * Usage:
 *   tsx src/scripts/import-automobile-data.ts [--file=path] [--collection=name]
 *                                              [--batch-size=n] [--dry-run]
 */
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { parse } from 'csv-parse';
import { z } from 'zod';
import type { Automobile } from '../models/automobile.model';
import { db } from '../services/firestore.service';
import { logger } from '../utils/logger';

const FIRESTORE_BATCH_LIMIT = 500;
const MISSING_VALUE_MARKER = '?';

const WORD_TO_NUMBER: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  eight: 8,
  twelve: 12,
};

/** Blank cells and the dataset's own "?" marker both mean "missing". */
export function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === MISSING_VALUE_MARKER ? null : trimmed;
}

/** Converts a numeric-looking cell to a number, preserving `null` for missing values.
 *  A non-numeric, non-missing cell becomes NaN so the zod schema below flags it as invalid. */
export function toNullableNumber(value: unknown): number | null {
  const str = toNullableString(value);
  return str === null ? null : Number(str);
}

/** The dataset spells door/cylinder counts as words (e.g. "four"); converts them to numbers. */
export function toNullableWordNumber(value: unknown): number | null {
  const str = toNullableString(value);
  if (str === null) return null;
  const key = str.toLowerCase();
  return key in WORD_TO_NUMBER ? WORD_TO_NUMBER[key] : NaN;
}

export const rowSchema = z.object({
  symboling: z.preprocess(toNullableNumber, z.number().int().min(-3).max(3)),
  'normalized-losses': z.preprocess(toNullableNumber, z.number().nullable()),
  make: z.preprocess(toNullableString, z.string().min(1)),
  'fuel-type': z.preprocess(toNullableString, z.enum(['gas', 'diesel'])),
  aspiration: z.preprocess(toNullableString, z.enum(['std', 'turbo'])),
  'num-of-doors': z.preprocess(toNullableWordNumber, z.union([z.literal(2), z.literal(4)]).nullable()),
  'body-style': z.preprocess(
    toNullableString,
    z.enum(['hardtop', 'wagon', 'sedan', 'hatchback', 'convertible']),
  ),
  'drive-wheels': z.preprocess(toNullableString, z.enum(['4wd', 'fwd', 'rwd'])),
  'engine-location': z.preprocess(toNullableString, z.enum(['front', 'rear'])),
  'wheel-base': z.preprocess(toNullableNumber, z.number()),
  length: z.preprocess(toNullableNumber, z.number()),
  width: z.preprocess(toNullableNumber, z.number()),
  height: z.preprocess(toNullableNumber, z.number()),
  'curb-weight': z.preprocess(toNullableNumber, z.number()),
  'engine-type': z.preprocess(
    toNullableString,
    z.enum(['dohc', 'dohcv', 'l', 'ohc', 'ohcf', 'ohcv', 'rotor']),
  ),
  'num-of-cylinders': z.preprocess(toNullableWordNumber, z.number()),
  'engine-size': z.preprocess(toNullableNumber, z.number()),
  'fuel-system': z.preprocess(
    toNullableString,
    z.enum(['1bbl', '2bbl', '4bbl', 'idi', 'mfi', 'mpfi', 'spdi', 'spfi']),
  ),
  bore: z.preprocess(toNullableNumber, z.number().nullable()),
  stroke: z.preprocess(toNullableNumber, z.number().nullable()),
  'compression-ratio': z.preprocess(toNullableNumber, z.number()),
  horsepower: z.preprocess(toNullableNumber, z.number().nullable()),
  'peak-rpm': z.preprocess(toNullableNumber, z.number().nullable()),
  'city-mpg': z.preprocess(toNullableNumber, z.number()),
  'highway-mpg': z.preprocess(toNullableNumber, z.number()),
  price: z.preprocess(toNullableNumber, z.number().nullable()),
});

export type ValidatedRow = z.infer<typeof rowSchema>;

export function toFirestoreDoc(row: ValidatedRow): Automobile {
  return {
    symboling: row.symboling,
    normalizedLosses: row['normalized-losses'],
    make: row.make,
    fuelType: row['fuel-type'],
    aspiration: row.aspiration,
    numOfDoors: row['num-of-doors'],
    bodyStyle: row['body-style'],
    driveWheels: row['drive-wheels'],
    engineLocation: row['engine-location'],
    wheelBase: row['wheel-base'],
    length: row.length,
    width: row.width,
    height: row.height,
    curbWeight: row['curb-weight'],
    engineType: row['engine-type'],
    numOfCylinders: row['num-of-cylinders'],
    engineSize: row['engine-size'],
    fuelSystem: row['fuel-system'],
    bore: row.bore,
    stroke: row.stroke,
    compressionRatio: row['compression-ratio'],
    horsepower: row.horsepower,
    peakRpm: row['peak-rpm'],
    cityMpg: row['city-mpg'],
    highwayMpg: row['highway-mpg'],
    price: row.price,
  };
}

export interface ImportOptions {
  filePath: string;
  collectionName: string;
  batchSize: number;
  dryRun: boolean;
}

export interface ImportSummary {
  totalRows: number;
  imported: number;
  skipped: number;
}

export function parseArgs(argv: string[]): ImportOptions {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? 'true');
  }

  const requestedBatchSize = Number(flags.get('batch-size') ?? FIRESTORE_BATCH_LIMIT);

  return {
    filePath: resolve(flags.get('file') ?? 'data/automobile.csv'),
    collectionName: flags.get('collection') ?? 'automobiles',
    batchSize: Math.min(requestedBatchSize, FIRESTORE_BATCH_LIMIT),
    dryRun: flags.has('dry-run'),
  };
}

/** `firestore` defaults to the real singleton; tests inject a fake in its place. */
export async function run(
  firestore: Firestore = db,
  argv: string[] = process.argv.slice(2),
): Promise<ImportSummary> {
  const options = parseArgs(argv);
  logger.info('Starting automobile CSV import', options);

  const parser = createReadStream(options.filePath).pipe(
    parse({ columns: true, trim: true, skip_empty_lines: true }),
  );
  const collectionRef = firestore.collection(options.collectionName);

  let batch = firestore.batch();
  let opsInBatch = 0;
  let totalRows = 0;
  let importedRows = 0;
  let skippedRows = 0;

  const commitBatch = async (): Promise<void> => {
    if (opsInBatch === 0) return;
    if (!options.dryRun) {
      await batch.commit();
    }
    logger.info(`Committed batch of ${opsInBatch} document(s)${options.dryRun ? ' [dry run]' : ''}`);
    batch = firestore.batch();
    opsInBatch = 0;
  };

  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    totalRows += 1;
    const result = rowSchema.safeParse(record);

    if (!result.success) {
      skippedRows += 1;
      const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      logger.warn(`Row ${totalRows} skipped: ${issues}`);
      continue;
    }

    batch.set(collectionRef.doc(), toFirestoreDoc(result.data));
    opsInBatch += 1;
    importedRows += 1;

    if (opsInBatch >= options.batchSize) {
      await commitBatch();
    }
  }

  await commitBatch();

  const summary: ImportSummary = { totalRows, imported: importedRows, skipped: skippedRows };
  logger.info('Import complete', summary);
  return summary;
}

/* istanbul ignore next -- exercised via `run()` directly in tests, not as a CLI process */
if (require.main === module) {
  run().catch((error) => {
    logger.error('Import failed', error);
    process.exitCode = 1;
  });
}
