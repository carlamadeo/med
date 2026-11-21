import {render} from 'preact';
import {act} from 'preact/test-utils';
import {http, HttpResponse} from 'msw';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {directoriesReady, studiesReady, syncing} from '@presentation/state/store';
import {mountPage} from './page';
import {server} from './server';

const queue = new Outbox();
afterEach(async () => {
    const app = document.getElementById('app');
    if (app) render(null, app);
    await driveAuth.signOut();
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('shows the verified account’s pending work if Drive becomes unreachable', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    await mountPage();
    await vi.waitFor(() => {
        expect(driveAuth.cachedAccountId()).toBe('account-one');
        expect(studiesReady.value).toBe(true);
        expect(directoriesReady.value).toBe(true);
    });
    await queue.enqueueSave('account-one', {
        title: 'Cambio pendiente',
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: ''
    });
    server.use(http.get('https://www.googleapis.com/drive/v3/about', () => HttpResponse.error()));
    act(() => {
        window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => {
        const pendingText = document.querySelector('#pending-changes')?.textContent ?? '';
        expect(pendingText).toContain('Cambio pendiente');
        expect(pendingText).toContain('No se pudieron sincronizar los cambios pendientes.');
        expect(syncing.value).toBe(false);
        expect(studiesReady.value).toBe(true);
        expect(directoriesReady.value).toBe(true);
    });
    expect(await queue.list('account-one')).toHaveLength(1);
});
