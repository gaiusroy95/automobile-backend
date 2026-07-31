import { z } from 'zod';

export const ORIGINS = ['usa', 'europe', 'japan'] as const;

/**
 * The Automobile domain shape, matching the real dataset exactly (Kaggle's
 * tawfikelmetwally/automobile-dataset, the classic "Auto MPG" dataset — one row per vehicle,
 * not the "Automobile"/imports-85 spec-sheet dataset this was originally, incorrectly, built
 * around). See `src/scripts/import-automobile-data.ts` for the raw CSV column mapping.
 */
export interface Automobile {
  name: string;
  mpg: number;
  cylinders: number;
  displacement: number;
  /** Null for the ~6 rows the source data leaves blank. */
  horsepower: number | null;
  weight: number;
  acceleration: number;
  /** Full 4-digit year (the source CSV stores it as a 2-digit year, e.g. 70 for 1970). */
  modelYear: number;
  origin: (typeof ORIGINS)[number];
}

export interface PaginationParams {
  /** Page size, clamped to [1, MAX_PAGE_SIZE] by the service. Defaults to the service's page size. */
  limit?: number;
  /** Document ID of the last item from the previous page. Omit to fetch the first page. */
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AutomobileFilters {
  origin?: Automobile['origin'];
  cylinders?: number;
  minMpg?: number;
  maxMpg?: number;
}

export const SORTABLE_FIELDS = [
  'name',
  'mpg',
  'cylinders',
  'displacement',
  'horsepower',
  'weight',
  'acceleration',
  'modelYear',
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

export interface SortParams {
  sortBy?: SortableField;
  sortOrder?: SortOrder;
}

/** Combines a free-text `name` prefix search with the structured filters above. */
export interface SearchParams extends AutomobileFilters, SortParams {
  q?: string;
}

// --- Request validation (Zod) ---------------------------------------------------------------
// Kept alongside the domain shape above since both describe "what a valid Automobile request/
// record looks like" — the schemas below validate HTTP input, the interfaces above type the
// resulting Firestore document.

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
  sortBy: z.enum(SORTABLE_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).optional(),
  origin: z.enum(ORIGINS).optional(),
  cylinders: z.coerce.number().int().positive().optional(),
  minMpg: z.coerce.number().nonnegative().optional(),
  maxMpg: z.coerce.number().nonnegative().optional(),
});

export const exportQuerySchema = searchQuerySchema.omit({ limit: true, cursor: true });

export const idParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Full record shape for `POST /cars`. Unlike the CSV importer's schema (which parses
 * string-typed cells), this validates a JSON body from the frontend's add-car form, where
 * fields already arrive as real numbers/nulls — so it's stricter, with no string-to-number
 * coercion.
 */
export const createAutomobileSchema = z.object({
  name: z.string().trim().min(1),
  mpg: z.number().nonnegative(),
  cylinders: z.number().int().positive(),
  displacement: z.number().positive(),
  horsepower: z.number().nonnegative().nullable(),
  weight: z.number().positive(),
  acceleration: z.number().positive(),
  modelYear: z.number().int(),
  origin: z.enum(ORIGINS),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type IdParam = z.infer<typeof idParamSchema>;
export type CreateAutomobileInput = z.infer<typeof createAutomobileSchema>;
