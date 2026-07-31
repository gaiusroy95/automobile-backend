import { pipeline } from 'node:stream/promises';
import { stringify } from 'csv-stringify';
import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/apiResponse';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { automobileService } from '../services/automobile.service';
import type { ExportQuery, IdParam, SearchQuery } from '../models/automobile.model';

const CSV_COLUMNS = [
  'id',
  'symboling',
  'normalizedLosses',
  'make',
  'fuelType',
  'aspiration',
  'numOfDoors',
  'bodyStyle',
  'driveWheels',
  'engineLocation',
  'wheelBase',
  'length',
  'width',
  'height',
  'curbWeight',
  'engineType',
  'numOfCylinders',
  'engineSize',
  'fuelSystem',
  'bore',
  'stroke',
  'compressionRatio',
  'horsepower',
  'peakRpm',
  'cityMpg',
  'highwayMpg',
  'price',
];

/**
 * Handles both `GET /cars` and `GET /cars/search` (kept as a backward-compatible alias) — both
 * accept the same full param set (pagination, sorting, text search, structured filters) via
 * `searchQuerySchema`, so there's no behavioral difference between the two paths.
 */
export const listAutomobiles = asyncHandler(async (req: Request, res: Response) => {
  const { limit, cursor, ...params } = req.validated.query as SearchQuery;
  const result = await automobileService.query(params, { limit, cursor });
  sendSuccess(res, result);
});

export const getAutomobileById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validated.params as IdParam;
  const automobile = await automobileService.getById(id);

  if (!automobile) {
    throw new ApiError(404, `Automobile not found: ${id}`);
  }

  sendSuccess(res, automobile);
});

/** Alias of `listAutomobiles` — see the doc comment there. */
export const searchAutomobiles = listAutomobiles;

export const exportAutomobiles = asyncHandler(async (req: Request, res: Response) => {
  const params = req.validated.query as ExportQuery;
  const rows = automobileService.streamForExport(params);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="automobiles.csv"');

  await pipeline(rows, stringify({ header: true, columns: CSV_COLUMNS }), res);
});
