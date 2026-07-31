import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from '../test-utils/fakeFirestore';
import { FirestoreService } from './firestore.service';

interface Widget {
  name: string;
  count: number;
}

describe('FirestoreService', () => {
  let fake: FakeFirestore;
  let service: FirestoreService<Widget>;

  beforeEach(() => {
    fake = new FakeFirestore();
    service = new FirestoreService<Widget>('widgets', fake as unknown as Firestore);
  });

  it('creates a document with an explicit id', async () => {
    const id = await service.create({ name: 'a', count: 1 }, 'widget-1');

    expect(id).toBe('widget-1');
    await expect(service.findById('widget-1')).resolves.toEqual({
      id: 'widget-1',
      name: 'a',
      count: 1,
    });
  });

  it('creates a document with an auto-generated id when none is given', async () => {
    const id = await service.create({ name: 'b', count: 2 });

    const found = await service.findById(id);
    expect(found?.name).toBe('b');
  });

  it('findAll returns every document in the collection', async () => {
    await service.create({ name: 'a', count: 1 }, 'w1');
    await service.create({ name: 'b', count: 2 }, 'w2');

    const all = await service.findAll();

    expect(all).toHaveLength(2);
    expect(all.map((w) => w.name).sort()).toEqual(['a', 'b']);
  });

  it('update merges fields onto the existing document', async () => {
    await service.create({ name: 'a', count: 1 }, 'w1');

    await service.update('w1', { count: 5 });

    await expect(service.findById('w1')).resolves.toEqual({ id: 'w1', name: 'a', count: 5 });
  });

  it('delete removes the document', async () => {
    await service.create({ name: 'a', count: 1 }, 'w1');

    await service.delete('w1');

    await expect(service.findById('w1')).resolves.toBeNull();
  });

  it('findById returns null for a document that does not exist', async () => {
    await expect(service.findById('missing')).resolves.toBeNull();
  });
});
