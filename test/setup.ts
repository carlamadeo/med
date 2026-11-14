import 'fake-indexeddb/auto';
import {Blob as NodeBlob, File as NodeFile} from 'node:buffer';
import {afterAll, afterEach, beforeAll, beforeEach, vi} from 'vitest';
import {storage} from '@core/storage';
import {resetFakeDrive} from './fake-drive';
import {installGis, resetGis} from './fake-google';
import {server} from './server';

// jsdom ships its own Blob/File, which Node's fetch (undici) serializes as "[object Blob]" when used
// as a request body. Browsers don't have this problem; use Node's classes so uploads reach MSW intact.
// Vitest's jsdom Request wrapper captures window.Blob dynamically. With native Blob/File below it
// mistakes Node's Blob for a jsdom wrapper, so use the native Request underneath that wrapper.
const NativeRequest = Object.getPrototypeOf(Request) as typeof Request;
Object.assign(globalThis, {Blob: NodeBlob, File: NodeFile, Request: NativeRequest});

beforeAll(() => server.listen({onUnhandledRequest: 'error'}));
afterAll(() => server.close());

beforeEach(async () => {
    resetFakeDrive();
    resetGis();
    installGis();
    window.sessionStorage.clear();
    await storage.clearStudyCache();
});

afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
});

// jsdom does not implement the <dialog> modal APIs. These stand-ins keep what the app relies on: `open` flips
// and `close` fires, so code that checks `dialog.open` or listens for 'close' behaves as in a browser.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
};
Element.prototype.scrollIntoView = vi.fn();

// jsdom does not implement media queries.
window.matchMedia = vi.fn().mockReturnValue({matches: false});

// jsdom has no layout; provide a viewport for the virtualized list.
Object.defineProperties(HTMLElement.prototype, {
    clientHeight: {configurable: true, get: () => 600},
    clientWidth: {configurable: true, get: () => 800}
});
