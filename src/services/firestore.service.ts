import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { firebaseApp } from '../config/firebase';
import { config } from '../config';

export const db: Firestore = getFirestore(firebaseApp);

if (config.firebase.emulatorHost) {
  db.settings({
    host: config.firebase.emulatorHost,
    ssl: false,
  });
}

export type WithId<T> = T & { id: string };

/**
 * Generic Firestore data-access wrapper for a single collection.
 * Contains no domain logic — feature modules supply the type and collection name.
 */
export class FirestoreService<T extends DocumentData> {
  protected readonly collection: FirebaseFirestore.CollectionReference<T>;

  /** `firestore` defaults to the real singleton; tests can inject a fake in its place. */
  constructor(collectionName: string, firestore: Firestore = db) {
    this.collection = firestore.collection(
      collectionName,
    ) as FirebaseFirestore.CollectionReference<T>;
  }

  async findById(id: string): Promise<WithId<T> | null> {
    const snapshot = await this.collection.doc(id).get();
    return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as WithId<T>) : null;
  }

  async findAll(): Promise<WithId<T>[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as WithId<T>);
  }

  async create(data: T, id?: string): Promise<string> {
    if (id) {
      await this.collection.doc(id).set(data);
      return id;
    }
    const ref = await this.collection.add(data);
    return ref.id;
  }

  async update(id: string, data: Partial<T>): Promise<void> {
    await this.collection.doc(id).update(data as DocumentData);
  }

  async delete(id: string): Promise<void> {
    await this.collection.doc(id).delete();
  }
}
