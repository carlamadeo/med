import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {fakeDriveFile, touchRemote} from './fake-drive';
import {$, mountPage, rowIds, typeInto} from './page';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('compares a conflict and applies the local change against the reviewed Drive revision', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mountPage();
    await vi.waitFor(() => expect(rowIds()).toContain('study-1'));
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
        document.querySelector<HTMLButtonElement>('#results li[data-id="study-1"] .edit')!.click();
    });
    act(() => {
        typeInto('#editor-title-field', 'Mi cambio local');
    });
    await act(async () => {
        $<HTMLFormElement>('#editor-form').requestSubmit();
    });
    await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(1));
    const file = fakeDriveFile('study-1')!;
    file.description = JSON.stringify({...JSON.parse(file.description), title: 'Cambio remoto'});
    touchRemote('study-1');
    online.mockReturnValue(true);
    act(() => {
        window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(async () => expect((await queue.list('account-one'))[0]?.status).toBe('conflict'));
    await vi.waitFor(() => expect(document.querySelector('#pending-changes')?.textContent).toContain('Cambio remoto'));
    expect(document.querySelector('#pending-changes')?.textContent).toContain('Mi cambio local');
    const button = [...document.querySelectorAll<HTMLButtonElement>('#pending-changes button')].find((item) => item.textContent === 'Conservar mi cambio')!;
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    await act(async () => {
        button.click();
    });
    await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
    expect(JSON.parse(file.description).title).toBe('Mi cambio local');
    expect(file.version).toBe(3);
});
