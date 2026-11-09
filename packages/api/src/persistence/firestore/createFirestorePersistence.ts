import type { Firestore } from '@google-cloud/firestore';
import type { Persistence } from '../Persistence';
import {
  FirestoreAuditLog,
  FirestoreBookingRepository,
  FirestoreCredentialStore,
  FirestoreResourceRepository,
  FirestoreUserRepository,
} from './firestoreRepositories';

const COLLECTIONS = [
  'users',
  'resources',
  'bookings',
  'auditEvents',
  'credentials',
  'system',
] as const;

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
  const collection = (name: (typeof COLLECTIONS)[number]) =>
    db.collection(`${collectionPrefix}${name}`);
  const demoSeedDoc = collection('system').doc('demoSeed');

  return {
    kind: 'firestore',
    repositories: {
      users: new FirestoreUserRepository(db, collection('users')),
      resources: new FirestoreResourceRepository(collection('resources')),
      bookings: new FirestoreBookingRepository(collection('bookings')),
      auditLog: new FirestoreAuditLog(collection('auditEvents')),
    },
    credentials: new FirestoreCredentialStore(collection('credentials')),
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
        await db.recursiveDelete(collection(name));
      }
    },
    close: () => db.terminate(),
  };
}
