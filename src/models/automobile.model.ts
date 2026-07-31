import { z } from 'zod';

/** The Automobile domain shape, as stored in Firestore (camelCase, snake-cased source columns). */
export interface Automobile {
  symboling: number;
  normalizedLosses: number | null;
  make: string;
  fuelType: 'gas' | 'diesel';
  aspiration: 'std' | 'turbo';
  numOfDoors: 2 | 4 | null;
  bodyStyle: 'hardtop' | 'wagon' | 'sedan' | 'hatchback' | 'convertible';
  driveWheels: '4wd' | 'fwd' | 'rwd';
  engineLocation: 'front' | 'rear';
  wheelBase: number;
  length: number;
  width: number;
  height: number;
  curbWeight: number;
  engineType: 'dohc' | 'dohcv' | 'l' | 'ohc' | 'ohcf' | 'ohcv' | 'rotor';
  numOfCylinders: number;
  engineSize: number;
  fuelSystem: '1bbl' | '2bbl' | '4bbl' | 'idi' | 'mfi' | 'mpfi' | 'spdi' | 'spfi';
  bore: number | null;
  stroke: number | null;
  compressionRatio: number;
  horsepower: number | null;
  peakRpm: number | null;
  cityMpg: number;
  highwayMpg: number;
  price: number | null;
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
  make?: string;
  fuelType?: Automobile['fuelType'];
  aspiration?: Automobile['aspiration'];
  bodyStyle?: Automobile['bodyStyle'];
  driveWheels?: Automobile['driveWheels'];
  engineLocation?: Automobile['engineLocation'];
  minPrice?: number;
  maxPrice?: number;
}

export const SORTABLE_FIELDS = [
  'make',
  'price',
  'cityMpg',
  'highwayMpg',
  'horsepower',
  'symboling',
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

export interface SortParams {
  sortBy?: SortableField;
  sortOrder?: SortOrder;
}

/** Combines a free-text `make` prefix search with the structured filters above. */
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
  make: z.string().min(1).optional(),
  fuelType: z.enum(['gas', 'diesel']).optional(),
  aspiration: z.enum(['std', 'turbo']).optional(),
  bodyStyle: z.enum(['hardtop', 'wagon', 'sedan', 'hatchback', 'convertible']).optional(),
  driveWheels: z.enum(['4wd', 'fwd', 'rwd']).optional(),
  engineLocation: z.enum(['front', 'rear']).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
});

export const exportQuerySchema = searchQuerySchema.omit({ limit: true, cursor: true });

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type IdParam = z.infer<typeof idParamSchema>;
