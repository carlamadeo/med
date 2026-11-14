import {setupServer} from 'msw/node';
import {driveHandlers} from './fake-drive';

/** Shared MSW server; tests can add per-test overrides with `server.use(...)`. */
export const server = setupServer(...driveHandlers);
