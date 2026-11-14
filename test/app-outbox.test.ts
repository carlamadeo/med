import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {$, mountPage, rowIds, typeInto} from './page';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('queues a new study offline and synchronizes it on reconnection', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    await mountPage();
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
        $<HTMLButtonElement>('[data-add]').click();
    });
    act(() => {
        typeInto('#editor-title-field', 'Guardado sin red');
        typeInto('#editor-date-field', '2024-04-01');
    });
    const checkbox = $<HTMLInputElement>('#study-types input[value="Otro"]');
    act(() => {
        checkbox.click();
    });
    await act(async () => {
        $<HTMLFormElement>('#editor-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#pending-changes')?.textContent).toContain('Guardado sin red'));
    expect(await queue.list('account-one')).toHaveLength(1);
    await vi.waitFor(() => expect(document.querySelector('#results')?.textContent).toContain('Guardado sin red'));
    expect(document.querySelector('#results')?.textContent).toContain('Pendiente de sincronización');
    online.mockReturnValue(true);
    act(() => {
        window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
    await vi.waitFor(() => expect(rowIds()).toContain('generated-1'));
});
