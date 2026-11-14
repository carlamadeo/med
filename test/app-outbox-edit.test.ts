import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {$, mountPage, rowIds, typeInto} from './page';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('shows a pending offline edit in the history', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    await mountPage();
    await vi.waitFor(() => expect(rowIds()).toContain('study-1'));
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
        document.querySelector<HTMLButtonElement>('#results li[data-id="study-1"] .edit')!.click();
    });
    act(() => {
        typeInto('#editor-title-field', 'Edición sin conexión');
    });
    await act(async () => {
        $<HTMLFormElement>('#editor-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#results li[data-id="study-1"]')?.textContent).toContain('Edición sin conexión'));
    const row = document.querySelector('#results li[data-id="study-1"]')!;
    expect(row.textContent).toContain('Pendiente de sincronización');
    expect(row.querySelector<HTMLButtonElement>('.edit')?.disabled).toBe(true);
});
