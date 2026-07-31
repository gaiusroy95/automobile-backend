/**
 * Imports the automobile dataset (Kaggle's tawfikelmetwally/automobile-dataset — the "Auto MPG"
 * schema: name, mpg, cylinders, displacement, horsepower, weight, acceleration, model_year,
 * origin) from a CSV file into Firestore. Run with `npm run import:automobile`.
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
import { ORIGINS, type Automobile } from '../models/automobile.model';
import { db } from '../services/firestore.service';
import { logger } from '../utils/logger';

const FIRESTORE_BATCH_LIMIT = 500;
const MISSING_VALUE_MARKER = '?';

/** The source CSV stores model year as 2 digits (e.g. 70); all values fall in 1900s territory. */
const YEAR_BASE = 1900;

/** Blank cells and the dataset's own "?" marker both mean "missing" (this particular CSV only
 *  ever uses blank cells, but "?" is handled too in case a different export of it doesn't). */
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

export const rowSchema = z.object({
  name: z.preprocess(toNullableString, z.string().min(1)),
  mpg: z.preprocess(toNullableNumber, z.number().nonnegative()),
  cylinders: z.preprocess(toNullableNumber, z.number().int().positive()),
  displacement: z.preprocess(toNullableNumber, z.number().positive()),
  horsepower: z.preprocess(toNullableNumber, z.number().nonnegative().nullable()),
  weight: z.preprocess(toNullableNumber, z.number().positive()),
  acceleration: z.preprocess(toNullableNumber, z.number().positive()),
  model_year: z.preprocess(toNullableNumber, z.number().int().nonnegative()),
  origin: z.preprocess(toNullableString, z.enum(ORIGINS)),
});

export type ValidatedRow = z.infer<typeof rowSchema>;

export function toFirestoreDoc(row: ValidatedRow): Automobile {
  return {
    name: row.name,
    mpg: row.mpg,
    cylinders: row.cylinders,
    displacement: row.displacement,
    horsepower: row.horsepower,
    weight: row.weight,
    acceleration: row.acceleration,
    modelYear: YEAR_BASE + row.model_year,
    origin: row.origin,
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
    const key = match?.[1];
    if (key) flags.set(key, match?.[2] ?? 'true');
  }

  const requestedBatchSize = Number(flags.get('batch-size') ?? FIRESTORE_BATCH_LIMIT);

  return {
    filePath: resolve(flags.get('file') ?? 'data/Automobile.csv'),
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
