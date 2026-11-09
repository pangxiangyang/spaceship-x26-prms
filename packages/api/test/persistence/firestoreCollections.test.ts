import { describe, expect, it } from 'vitest';
import { createFirestoreClient } from '../../src/persistence/firestore/createFirestoreClient';
import { firestoreCollections } from '../../src/persistence/firestore/createFirestorePersistence';

// Building references makes no network calls, so no Firestore target is needed.
const db = createFirestoreClient({ projectId: 'demo-prms', databaseId: '(default)' });

describe('Firestore collections', () => {
  it('uses root collections for the default namespace', () => {
    expect(firestoreCollections(db, '').bookings.path).toBe('bookings');
  });

  it('keeps collection ids unchanged inside a namespace, so composite indexes apply', () => {
    const { bookings, auditEvents } = firestoreCollections(db, 'staging');
    expect(bookings.path).toBe('environments/staging/bookings');
    expect(bookings.id).toBe('bookings');
    expect(auditEvents.id).toBe('auditEvents');
  });

  it('refuses a namespace that is not a plain document id', () => {
    expect(() => firestoreCollections(db, 'bad/namespace')).toThrow();
    expect(() => firestoreCollections(db, '__reserved__')).toThrow();
  });
});
