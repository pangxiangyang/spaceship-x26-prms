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

const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]*$/;
/** Firestore reserves document ids of this form. */
const RESERVED_ID = /^__.*__$/;

/**
 * Where an environment's collections live. The default namespace uses root collections;
 * any other lives under `environments/{namespace}`. Either way the collection ids stay
 * `bookings`, `auditEvents` and so on, which is what composite indexes are defined on.
 */
export function firestoreCollections(db: Firestore, namespace: string): FirestoreCollections {
  if (!NAMESPACE_PATTERN.test(namespace) || RESERVED_ID.test(namespace)) {
    throw new Error('A Firestore namespace may contain only letters, digits, "_" and "-".');
  }
  const parent = namespace ? db.collection('environments').doc(namespace) : db;
  return Object.fromEntries(
    COLLECTIONS.map((name) => [name, parent.collection(name)]),
  ) as unknown as FirestoreCollections;
}

/**
 * Firestore-backed storage. A `namespace` keeps an environment's data apart (staging,
 * a developer, a test run), so several can share one database safely.
 */
export function createFirestorePersistence(db: Firestore, namespace = ''): Persistence {
  const collections = firestoreCollections(db, namespace);
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
