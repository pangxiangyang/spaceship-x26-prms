import { describe } from 'vitest';
import { createFirestoreTestPersistence, firestoreTestProject } from '../support/firestoreTarget';
import { describePersistenceContract } from './persistenceContract';

describe.runIf(firestoreTestProject)('Firestore', () => {
  describePersistenceContract('Firestore', createFirestoreTestPersistence);
});
