import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {http, HttpResponse, type RequestHandler} from 'msw';
import {expect, vi} from 'vitest';
import {driveAuth} from '@data';
import {view} from '@presentation/state/store';
import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {LibraryPage} from '@presentation/pages/LibraryPage';
import {installGis, resetGis} from './fake-google';
import {server} from './server';

export const TYPES = ['Ecografía', 'Mamografía', 'Otro'];
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

export const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) =>
    root.querySelector<T>(selector)!;
export const text = (selector: string) => document.querySelector(selector)?.textContent?.trim();
export const rowIds = () => [...document.querySelectorAll<HTMLElement>('#results li.record')].map((li) => li.dataset.id);
export const typesHandler = (types: string[] = TYPES) => http.get('*/types.json', () => HttpResponse.json(types));

/** Puts the real index.html in jsdom and starts the real App on it. One App per test file. */
export async function mountPage({
                                    signIn = true,
                                    types,
                                }: { signIn?: boolean; types?: RequestHandler } = {}): Promise<void> {
    // Global beforeEach hooks have not run yet when a test file's beforeAll does.
    resetGis();
    installGis();
    document.documentElement.innerHTML = html;
    document.documentElement.lang = 'es';
    view.value = 'cronologia';
    server.use(types ?? typesHandler());
    await act(() => {
        render(h(LibraryPage, {}), document.getElementById('app')!);
    });
    if (signIn) {
        await act(async () => {
            await driveAuth.signIn();
        });
        await vi.waitFor(() => expect($('#library').hidden).toBe(false));
        if (!types) await vi.waitFor(() => expect(document.querySelectorAll('#study-types input')).toHaveLength(TYPES.length));
    }
}

/** Signs out and in again: the App reacts to the auth change by reloading the list from Drive. */
export async function reloadLibrary(): Promise<void> {
    await act(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });
    await vi.waitFor(() => expect($('#library').hidden).toBe(false));
    // Done when the list has rendered (the status text leaves "Cargando…") or loading has failed.
    await vi.waitFor(() =>
        expect(text('#list-status') !== 'Cargando tus estudios…').toBe(true)
    );
}

/** Tests share one document, so a dialog left open by one would change how the next one behaves. */
export function closeDialogs(): void {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) dialog.close();
    // `choose()` fakes the file picker by overriding `files`; a real form.reset() would have emptied it.
    const report = document.querySelector<HTMLInputElement>('#editor-form [name="report"]');
    if (report) Reflect.deleteProperty(report, 'files');
}

/** Simulates the browser's file picker. */
export function choose(name: string, file: File | null): void {
    const input = document.querySelector<HTMLInputElement>(`#editor-form [name="${name}"]`)!;
    Object.defineProperty(input, 'files', {configurable: true, value: file ? [file] : []});
    input.dispatchEvent(new Event('change', {bubbles: true}));
}

export function typeInto(selector: string, value: string): void {
    const input = $<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', {bubbles: true}));
}
