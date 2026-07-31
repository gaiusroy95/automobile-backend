import { Readable } from 'node:stream';

/**
 * A minimal in-memory stand-in for the slice of the Firestore Admin SDK this backend actually
 * uses (collection/doc/where/orderBy/limit/startAfter/get/stream/add/batch). It's deliberately
 * not a faithful full reimplementation (no composite-index errors, no multi-field range
 * restriction) — just enough behavior for unit and Supertest-level tests to run against
 * real query-building/pagination code without any network access.
 */

type StoredDoc = Record<string, unknown>;

export interface FakeSnapshotDoc {
  id: string;
  exists: boolean;
  data: () => StoredDoc | undefined;
}

type WhereOp = '==' | '>=' | '<=';

interface Clause {
  field: string;
  op: WhereOp;
  value: unknown;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function matchesClause(doc: FakeSnapshotDoc, clause: Clause): boolean {
  const actual = doc.data()?.[clause.field];
  switch (clause.op) {
    case '==':
      return actual === clause.value;
    case '>=':
      return compare(actual, clause.value) >= 0;
    case '<=':
      return compare(actual, clause.value) <= 0;
    default:
      throw new Error(`Unsupported operator in fake Firestore: ${String(clause.op)}`);
  }
}

function toSnapshotDoc(id: string, data: StoredDoc | undefined): FakeSnapshotDoc {
  return {
    id,
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
  };
}

type OrderDirection = 'asc' | 'desc';

export class FakeQuery {
  constructor(
    protected readonly store: Map<string, StoredDoc>,
    protected readonly clauses: Clause[] = [],
    protected readonly orderField: string | null = null,
    protected readonly limitCount: number | null = null,
    protected readonly cursorId: string | null = null,
    protected readonly orderDirection: OrderDirection = 'asc',
  ) {}

  where(field: string, op: WhereOp, value: unknown): FakeQuery {
    return new FakeQuery(
      this.store,
      [...this.clauses, { field, op, value }],
      this.orderField,
      this.limitCount,
      this.cursorId,
      this.orderDirection,
    );
  }

  orderBy(field: string, direction: OrderDirection = 'asc'): FakeQuery {
    return new FakeQuery(
      this.store,
      this.clauses,
      field,
      this.limitCount,
      this.cursorId,
      direction,
    );
  }

  limit(count: number): FakeQuery {
    return new FakeQuery(
      this.store,
      this.clauses,
      this.orderField,
      count,
      this.cursorId,
      this.orderDirection,
    );
  }

  startAfter(doc: FakeSnapshotDoc): FakeQuery {
    return new FakeQuery(
      this.store,
      this.clauses,
      this.orderField,
      this.limitCount,
      doc.id,
      this.orderDirection,
    );
  }

  private resolveDocs(): FakeSnapshotDoc[] {
    let docs = Array.from(this.store.entries()).map(([id, data]) => toSnapshotDoc(id, data));
    docs = docs.filter((doc) => this.clauses.every((clause) => matchesClause(doc, clause)));

    if (this.orderField) {
      const field = this.orderField;
      const sign = this.orderDirection === 'desc' ? -1 : 1;
      docs.sort(
        (a, b) => sign * compare(a.data()?.[field], b.data()?.[field]) || compare(a.id, b.id),
      );
    }

    if (this.cursorId) {
      const index = docs.findIndex((doc) => doc.id === this.cursorId);
      docs = index >= 0 ? docs.slice(index + 1) : docs;
    }

    if (this.limitCount !== null) {
      docs = docs.slice(0, this.limitCount);
    }

    return docs;
  }

  async get(): Promise<{ docs: FakeSnapshotDoc[]; empty: boolean; size: number }> {
    const docs = this.resolveDocs();
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  stream(): Readable {
    const docs = this.resolveDocs();
    const readable = new Readable({ objectMode: true, read() {} });
    queueMicrotask(() => {
      for (const doc of docs) readable.push(doc);
      readable.push(null);
    });
    return readable;
  }
}

let autoIdCounter = 0;

export class FakeCollection extends FakeQuery {
  constructor(store: Map<string, StoredDoc>) {
    super(store);
  }

  doc(id?: string) {
    const docId = id ?? `auto-${(autoIdCounter += 1)}`;
    const store = this.store;
    return {
      id: docId,
      async get(): Promise<FakeSnapshotDoc> {
        return toSnapshotDoc(docId, store.get(docId));
      },
      async set(data: StoredDoc): Promise<void> {
        store.set(docId, { ...data });
      },
      async update(data: Partial<StoredDoc>): Promise<void> {
        const existing = store.get(docId) ?? {};
        store.set(docId, { ...existing, ...data });
      },
      async delete(): Promise<void> {
        store.delete(docId);
      },
    };
  }

  async add(data: StoredDoc): Promise<{ id: string }> {
    const docId = `auto-${(autoIdCounter += 1)}`;
    this.store.set(docId, { ...data });
    return { id: docId };
  }
}

interface FakeDocRef {
  id: string;
  set: (data: StoredDoc) => Promise<void>;
  update: (data: Partial<StoredDoc>) => Promise<void>;
  delete: () => Promise<void>;
}

export class FakeFirestore {
  private readonly collections = new Map<string, Map<string, StoredDoc>>();

  private storeFor(name: string): Map<string, StoredDoc> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return this.collections.get(name) as Map<string, StoredDoc>;
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.storeFor(name));
  }

  batch() {
    const operations: Array<() => void> = [];
    return {
      set: (docRef: FakeDocRef, data: StoredDoc) => {
        operations.push(() => {
          void docRef.set(data);
        });
      },
      update: (docRef: FakeDocRef, data: Partial<StoredDoc>) => {
        operations.push(() => {
          void docRef.update(data);
        });
      },
      delete: (docRef: FakeDocRef) => {
        operations.push(() => {
          void docRef.delete();
        });
      },
      commit: async () => {
        for (const operation of operations) operation();
      },
    };
  }

  /**
   * Test helper: seeds a collection with known documents, replacing any existing contents.
   * Generic (rather than typed directly in terms of `StoredDoc`) so callers can pass a
   * `Record<string, SomeDomainType>` fixture without hitting TS's "index signature is
   * missing" error when a concrete interface is compared against `Record<string, unknown>`.
   */
  seed<T extends object>(name: string, docs: Record<string, T>): void {
    this.collections.set(name, new Map(Object.entries(docs)) as Map<string, StoredDoc>);
  }

  /** Test helper: reads back everything currently stored in a collection. */
  dump<T extends object = StoredDoc>(name: string): Array<{ id: string } & T> {
    return Array.from(this.storeFor(name).entries()).map(
      ([id, data]) => ({ id, ...data }) as { id: string } & T,
    );
  }
}
