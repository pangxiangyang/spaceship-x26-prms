import { createFirestoreClient } from '../../src/persistence/firestore/createFirestoreClient';
import { createFirestorePersistence } from '../../src/persistence/firestore/createFirestorePersistence';
import type { Persistence } from '../../src/persistence/Persistence';

/**
 * Firestore-backed tests run when either:
 *  - FIRESTORE_EMULATOR_HOST points at the Firestore emulator (CI), or
 *  - PRMS_FIRESTORE_TEST_PROJECT names a real project reachable with
 *    Application Default Credentials.
 * Each persistence writes under its own namespace, and tests wipe it.
 */
export const firestoreTestProject: string | undefined = process.env.FIRESTORE_EMULATOR_HOST
  ? (process.env.PRMS_FIRESTORE_TEST_PROJECT ?? 'demo-prms')
  : process.env.PRMS_FIRESTORE_TEST_PROJECT;

let counter = 0;

export function createFirestoreTestPersistence(): Persistence {
  if (!firestoreTestProject) throw new Error('No Firestore test target is configured.');
  counter += 1;
  const namespace = `test_${Date.now().toString(36)}_${process.pid}_${counter}`;
  const db = createFirestoreClient({ projectId: firestoreTestProject, databaseId: '(default)' });
  return createFirestorePersistence(db, namespace);
}
