import { Transform, type Readable } from 'node:stream';
import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreService, type WithId } from './firestore.service';
import { ApiError } from '../utils/ApiError';
import type {
  Automobile,
  AutomobileFilters,
  PaginatedResult,
  PaginationParams,
  SearchParams,
  SortableField,
  SortParams,
} from '../models/automobile.model';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export class AutomobileService extends FirestoreService<Automobile> {
  /** `firestore` defaults to the real singleton; tests can inject a fake in its place. */
  constructor(firestore?: Firestore) {
    super('automobiles', firestore);
  }

  async getAll(
    pagination: PaginationParams = {},
    sort: SortParams = {},
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    return this.paginate(this.buildQuery(sort), pagination);
  }

  async getById(id: string): Promise<WithId<Automobile> | null> {
    return this.findById(id);
  }

  /**
   * Firestore has no native full-text search; this matches on a `make` prefix
   * (e.g. "por" matches "porsche") using a range query.
   */
  async search(
    term: string,
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    return this.paginate(this.buildQuery({ q: term }), pagination);
  }

  /** Combines equality filters with an optional price range. */
  async filter(
    filters: AutomobileFilters,
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    return this.paginate(this.buildQuery(filters), pagination);
  }

  /** Combined entry point for the `/cars/search` route: text search and/or structured filters. */
  async query(
    params: SearchParams,
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    return this.paginate(this.buildQuery(params), pagination);
  }

  /**
   * Streams every matching document (no page limit) as plain `{ id, ...fields }` objects,
   * for CSV export. Uses Firestore's native cursor-based streaming rather than buffering
   * the whole result set in memory.
   */
  streamForExport(params: SearchParams = {}): Readable {
    const snapshotStream = this.buildQuery(params).stream() as Readable;

    const toDocument = new Transform({
      objectMode: true,
      transform(snapshot: QueryDocumentSnapshot<Automobile>, _encoding, callback) {
        callback(null, { id: snapshot.id, ...snapshot.data() });
      },
    });

    return snapshotStream.pipe(toDocument);
  }

  /**
   * Builds the Firestore query shared by getAll/search/filter/query/export. A price range and
   * a text search can't be combined: Firestore allows only one range (inequality) filter per
   * query, and the text search already uses one on `make`. For the same reason, `sortBy` must
   * agree with whichever field a range filter already forces the order onto (`make` for a text
   * search, `price` for a price range) — requesting a different one throws a 400 rather than
   * failing later with a raw Firestore error. Combining several equality filters with a range
   * filter may also require a composite index — Firestore's error message includes a direct
   * link to create it.
   */
  private buildQuery(params: SearchParams): Query<Automobile> {
    const {
      q,
      make,
      fuelType,
      aspiration,
      bodyStyle,
      driveWheels,
      engineLocation,
      minPrice,
      maxPrice,
      sortBy,
      sortOrder,
    } = params;

    const prefix = q?.trim().toLowerCase();
    const hasPriceRange = minPrice !== undefined || maxPrice !== undefined;

    if (prefix && hasPriceRange) {
      throw new ApiError(
        400,
        'Cannot combine a text search (q) with a price range filter: Firestore allows only one range filter per query.',
      );
    }

    const forcedOrderField: SortableField | null = prefix ? 'make' : hasPriceRange ? 'price' : null;

    if (sortBy && forcedOrderField && sortBy !== forcedOrderField) {
      const reason = prefix ? 'a text search (q)' : 'a price range filter';
      throw new ApiError(
        400,
        `Cannot sort by "${sortBy}" while using ${reason}: Firestore requires ordering by the ` +
          `same field the range filter already uses ("${forcedOrderField}").`,
      );
    }

    const direction = sortOrder ?? 'asc';

    let query: Query<Automobile> = this.collection;

    if (fuelType) query = query.where('fuelType', '==', fuelType);
    if (aspiration) query = query.where('aspiration', '==', aspiration);
    if (bodyStyle) query = query.where('bodyStyle', '==', bodyStyle);
    if (driveWheels) query = query.where('driveWheels', '==', driveWheels);
    if (engineLocation) query = query.where('engineLocation', '==', engineLocation);

    if (prefix) {
      return query
        .where('make', '>=', prefix)
        .where('make', '<=', `${prefix}`)
        .orderBy('make', direction);
    }

    if (make) query = query.where('make', '==', make);

    if (hasPriceRange) {
      if (minPrice !== undefined) query = query.where('price', '>=', minPrice);
      if (maxPrice !== undefined) query = query.where('price', '<=', maxPrice);
      return query.orderBy('price', direction);
    }

    return query.orderBy(sortBy ?? 'make', direction);
  }

  /**
   * Cursor-based pagination: fetches one extra document to determine `hasMore` without a
   * separate count query, and uses the last row's document snapshot as the next cursor.
   */
  private async paginate(
    query: Query<Automobile>,
    { limit = DEFAULT_PAGE_SIZE, cursor }: PaginationParams,
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    const pageSize = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
    let pagedQuery = query.limit(pageSize + 1);

    if (cursor) {
      const cursorSnapshot = await this.collection.doc(cursor).get();
      if (cursorSnapshot.exists) {
        pagedQuery = pagedQuery.startAfter(cursorSnapshot);
      }
    }

    const snapshot = await pagedQuery.get();
    const hasMore = snapshot.docs.length > pageSize;
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
    const lastDoc = docs[docs.length - 1];

    return {
      data: docs.map((doc) => ({ id: doc.id, ...doc.data() }) as WithId<Automobile>),
      nextCursor: hasMore && lastDoc ? lastDoc.id : null,
      hasMore,
    };
  }
}

export const automobileService = new AutomobileService();
