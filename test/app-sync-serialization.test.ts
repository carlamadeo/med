import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {mountPage} from './page';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('serializes repeated synchronization requests from the page', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()},
    });
    await mountPage();
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    await queue.enqueueSave('account-one', {
        title: 'Pendiente', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '',
    });

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    const sync = vi.spyOn(Outbox.prototype, 'sync').mockImplementationOnce(async () => blocked).mockResolvedValue(undefined);
    act(() => {
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
    });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    act(() => {
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sync).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(sync.mock.calls.length).toBeGreaterThanOrEqual(2));
});
