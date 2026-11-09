import type { Firestore } from '@google-cloud/firestore';
import type { Persistence } from '../Persistence';
import {
  FirestoreCredentialStore,
  FirestoreTransactionContext,
  FirestoreUnitOfWork,
  directRepositories,
  type FirestoreCollections,
} from './firestoreRepositories';

const COLLECTIONS = [
  'users',
  'resources',
  'bookings',
  'auditEvents',
  'credentials',
  'system',
  'usernames',
  'scheduleLocks',
] as const satisfies readonly (keyof FirestoreCollections)[];

/** gRPC status returned when `create` finds an existing document. */
const ALREADY_EXISTS = 6;

const PREFIX_PATTERN = /^[A-Za-z0-9_-]*$/;

/**
 * Firestore-backed storage. `collectionPrefix` namespaces every collection, so
 * several environments (or test runs) can share one database safely.
 */
export function createFirestorePersistence(db: Firestore, collectionPrefix = ''): Persistence {
  if (!PREFIX_PATTERN.test(collectionPrefix)) {
    throw new Error('Firestore collection prefix may contain only letters, digits, "_" and "-".');
  }
  const collections = Object.fromEntries(
    COLLECTIONS.map((name) => [name, db.collection(`${collectionPrefix}${name}`)]),
  ) as unknown as FirestoreCollections;
  const unitOfWork = new FirestoreUnitOfWork(db, collections);
  const demoSeedDoc = collections.system.doc('demoSeed');

  return {
    kind: 'firestore',
    repositories: directRepositories(collections, unitOfWork),
    unitOfWork,
    credentials: new FirestoreCredentialStore(collections.credentials),
    credentialsIn: (tx) => {
      if (!(tx instanceof FirestoreTransactionContext)) {
        throw new Error('Not a unit of work of this storage.');
      }
      return tx.credentials;
    },
    demoSeed: {
      // `create` is atomic: if two instances start at once, only one seeds.
      claim: async (at) => {
        try {
          await demoSeedDoc.create({ seededAt: at });
          return true;
        } catch (error) {
          if ((error as { code?: number }).code === ALREADY_EXISTS) return false;
          throw error;
        }
      },
    },
    wipe: async () => {
      for (const name of COLLECTIONS) {
        await db.recursiveDelete(collections[name]);
      }
    },
    close: () => db.terminate(),
  };
}
