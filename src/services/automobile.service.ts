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

  /** Firestore has no native full-text search; this matches on a `name` prefix (e.g. "chevro"
   *  matches "chevrolet chevelle malibu") using a range query. */
  async search(
    term: string,
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    return this.paginate(this.buildQuery({ q: term }), pagination);
  }

  /** Combines equality filters (origin, cylinders) with an optional MPG range. */
  async filter(
    filters: AutomobileFilters,
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<WithId<Automobile>>> {
    return this.paginate(this.buildQuery(filters), pagination);
  }

  /** Combined entry point for `/cars` and `/cars/search`: text search and/or structured filters. */
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
   * Builds the Firestore query shared by getAll/search/filter/query/export.
   *
   * Two Firestore indexing rules drive most of the logic here:
   *  1) An MPG range and a text search can't be combined: Firestore allows only one range
   *     (inequality) filter per query, and the text search already uses one on `name`. For the
   *     same reason, `sortBy` must agree with whichever field a range filter already forces the
   *     order onto (`name` for a text search, `mpg` for an MPG range) — requesting a different
   *     one throws a 400 rather than failing later with a raw Firestore error.
   *  2) Combining a `where()` equality filter (`origin`, `cylinders`) with an `orderBy()` on a
   *     *different* field needs a composite index. We can't guarantee one exists for every
   *     filter, so we only ever add an `orderBy` when the caller explicitly asked for one
   *     (`sortBy`) or Firestore forces it (the range cases above). A plain equality filter with
   *     no `sortBy` gets no `orderBy` at all — Firestore's default (order by document ID) needs
   *     no index, and the client sorts for display anyway.
   */
  private buildQuery(params: SearchParams): Query<Automobile> {
    const { q, origin, cylinders, minMpg, maxMpg, sortBy, sortOrder } = params;

    const prefix = q?.trim().toLowerCase();
    const hasMpgRange = minMpg !== undefined || maxMpg !== undefined;

    if (prefix && hasMpgRange) {
      throw new ApiError(
        400,
        'Cannot combine a text search (q) with an MPG range filter: Firestore allows only one range filter per query.',
      );
    }

    const forcedOrderField: SortableField | null = prefix ? 'name' : hasMpgRange ? 'mpg' : null;

    if (sortBy && forcedOrderField && sortBy !== forcedOrderField) {
      const reason = prefix ? 'a text search (q)' : 'an MPG range filter';
      throw new ApiError(
        400,
        `Cannot sort by "${sortBy}" while using ${reason}: Firestore requires ordering by the ` +
          `same field the range filter already uses ("${forcedOrderField}").`,
      );
    }

    const direction = sortOrder ?? 'asc';

    let query: Query<Automobile> = this.collection;

    if (origin) query = query.where('origin', '==', origin);
    if (cylinders !== undefined) query = query.where('cylinders', '==', cylinders);

    const hasEqualityFilter = Boolean(origin || cylinders !== undefined);

    if (prefix) {
      return query
        .where('name', '>=', prefix)
        .where('name', '<=', `${prefix}`)
        .orderBy('name', direction);
    }

    if (hasMpgRange) {
      if (minMpg !== undefined) query = query.where('mpg', '>=', minMpg);
      if (maxMpg !== undefined) query = query.where('mpg', '<=', maxMpg);
      return query.orderBy('mpg', direction);
    }

    if (sortBy) {
      return query.orderBy(sortBy, direction);
    }

    // No sort was requested — see rule 2) above for why we skip the default order in this case.
    return hasEqualityFilter ? query : query.orderBy('name', direction);
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
