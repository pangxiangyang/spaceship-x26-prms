import type { StorageConfig } from '../config';
import { createFirestoreClient } from './firestore/createFirestoreClient';
import { createFirestorePersistence } from './firestore/createFirestorePersistence';
import { createMemoryPersistence } from './memoryPersistence';
import type { Persistence } from './Persistence';

export function createPersistence(storage: StorageConfig): Persistence {
  switch (storage.kind) {
    case 'memory':
      return createMemoryPersistence();
    case 'firestore':
      return createFirestorePersistence(createFirestoreClient(storage), storage.collectionPrefix);
  }
}
