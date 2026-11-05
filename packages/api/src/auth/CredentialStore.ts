/** Stores password hashes, kept apart from the domain's user model. */
export interface CredentialStore {
  setPasswordHash(userId: string, hash: string): Promise<void>;
  getPasswordHash(userId: string): Promise<string | undefined>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly hashes = new Map<string, string>();

  async setPasswordHash(userId: string, hash: string): Promise<void> {
    this.hashes.set(userId, hash);
  }

  async getPasswordHash(userId: string): Promise<string | undefined> {
    return this.hashes.get(userId);
  }
}
