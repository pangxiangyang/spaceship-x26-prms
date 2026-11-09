import { Firestore } from '@google-cloud/firestore';

export interface FirestoreClientOptions {
  /** Omit on Google Cloud: the project is detected from the runtime or ADC. */
  projectId?: string;
  databaseId: string;
}

/**
 * Credentials come from Application Default Credentials: the service account on
 * Cloud Run, `gcloud auth application-default login` locally, or none at all
 * when FIRESTORE_EMULATOR_HOST is set.
 */
export function createFirestoreClient(options: FirestoreClientOptions): Firestore {
  return new Firestore({
    ...(options.projectId ? { projectId: options.projectId } : {}),
    databaseId: options.databaseId,
    ignoreUndefinedProperties: true,
  });
}
