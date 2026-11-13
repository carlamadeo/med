import { DriveClient } from './drive-api';
import { storage } from '@core/storage';
import type { AuthRepository } from '@domain/repository';

export class DriveAuthRepository implements AuthRepository {
  constructor(private client: DriveClient = new DriveClient()) {}

  get configured(): boolean {
    return this.client.configured;
  }

  isSignedIn(): boolean {
    return this.client.connected;
  }

  onAuthChange(callback: (signedIn: boolean) => void): () => void {
    return this.client.onAuthChange(callback);
  }

  restoreSession(): boolean {
    return this.client.restoreSession();
  }

  async signIn(): Promise<void> {
    return this.client.signIn();
  }

  async signOut(): Promise<void> {
    await this.client.signOut();
    // Medical data must not outlive the session in the browser.
    await storage.clearStudyCache();
  }

  async getAccessToken(): Promise<string> {
    return this.client.getAccessToken();
  }

  async getAccountId(): Promise<string> {
    return this.client.getAccountId();
  }

  cachedAccountId(): string | null { return this.client.cachedAccountId(); }
}

// Re-export errors for consumers
export { DriveError, DriveConflictError, DriveSessionError } from './drive-api';