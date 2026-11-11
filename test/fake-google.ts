import { vi } from 'vitest';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
}

interface TokenClientOptions {
  callback: (response: TokenResponse) => void;
}

/** Knobs for the fake Google Identity Services popup. */
export const gis: { authorizations: number; tokenResponse: TokenResponse } = {
  authorizations: 0,
  tokenResponse: {},
};

export function resetGis(): void {
  gis.authorizations = 0;
  gis.tokenResponse = { access_token: 'test-access-token', expires_in: 3600, scope: DRIVE_SCOPE };
}

/** Same contract as the real GIS: the response must carry every requested scope. */
export function installGis(): void {
  Object.defineProperty(window, 'google', {
    configurable: true,
    writable: true,
    value: {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }: TokenClientOptions) => ({
            requestAccessToken: vi.fn(() => {
              gis.authorizations += 1;
              setTimeout(() => callback(gis.tokenResponse), 0);
            }),
          }),
          hasGrantedAllScopes: (response: TokenResponse, ...scopes: string[]) =>
            scopes.every((scope) => response.scope?.split(' ').includes(scope)),
        },
      },
    },
  });
}
