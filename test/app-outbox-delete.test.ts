import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {fakeDriveFile} from './fake-drive';
import {$, mountPage, rowIds} from './page';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('queues an offline deletion and moves the study to Drive trash after reconnection', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    await mountPage();
    await vi.waitFor(() => expect(rowIds()).toContain('study-1'));
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
        document.querySelector<HTMLButtonElement>('#results li[data-id="study-1"] .remove')!.click();
    });
    await act(async () => {
        $<HTMLFormElement>('#delete-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#pending-changes')?.textContent).toContain('Eliminar Ecografía abdominal'));
    expect(fakeDriveFile('study-1')?.trashed).toBe(false);
    online.mockReturnValue(true);
    act(() => {
        window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => expect(fakeDriveFile('study-1')?.trashed).toBe(true));
    await vi.waitFor(() => expect(rowIds()).not.toContain('study-1'));
});
