import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {fakeDriveFile} from './fake-drive';
import {$, mountPage, typeInto} from './page';

const queue = new Outbox();
afterEach(async () => {
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
});

it('queues an operation and a portal offline and creates them in Drive after reconnecting', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    await mountPage();
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
        $<HTMLButtonElement>('#tab-operaciones').click();
    });
    act(() => {
        typeInto('#operation-name', 'Cirugía pendiente');
        typeInto('#operation-date', '2024-01-01');
        typeInto('#operation-type', 'Procedimiento');
    });
    await act(async () => {
        $<HTMLFormElement>('#operation-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#pending-changes')?.textContent).toContain('Cirugía pendiente'));
    expect(document.querySelector('#operations-list')?.textContent).toContain('Cirugía pendiente');
    expect(document.querySelector('#operations-list')?.textContent).toContain('Pendiente de sincronización');
    act(() => {
        $<HTMLButtonElement>('#tab-portales').click();
    });
    act(() => {
        typeInto('#portal-name', 'Clínica pendiente');
        typeInto('#portal-url', 'https://example.com');
    });
    await act(async () => {
        $<HTMLFormElement>('#portal-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#pending-changes')?.textContent).toContain('Clínica pendiente'));
    online.mockReturnValue(true);
    act(() => {
        window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
    expect(fakeDriveFile('generated-1')?.appProperties.misEstudios).toBe('operacion-v1');
    expect(fakeDriveFile('generated-2')?.appProperties.misEstudios).toBe('portal-v1');
});
