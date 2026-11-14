import {act} from 'preact/test-utils';
import {http, HttpResponse} from 'msw';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {mountPage} from './page';
import {server} from './server';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('shows the verified account’s pending work if Drive becomes unreachable', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    await mountPage();
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
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
    await vi.waitFor(() => expect(document.querySelector('#pending-changes')?.textContent).toContain('Cambio pendiente'));
    expect(await queue.list('account-one')).toHaveLength(1);
});
