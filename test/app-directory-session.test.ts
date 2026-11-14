import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {driveAuth, drivePortalRepo} from '@data';
import {portals} from '@presentation/state/store';
import {gis} from './fake-google';
import {$, mountPage, typeInto} from './page';

it('does not publish a portal saved after the account changes', async () => {
    await mountPage();
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    let release!: (value: Awaited<ReturnType<typeof drivePortalRepo.save>>) => void;
    const save = vi.spyOn(drivePortalRepo, 'save').mockImplementation(() => new Promise(resolve => {
        release = resolve;
    }));
    act(() => {
        $<HTMLButtonElement>('#tab-portales').click();
    });
    act(() => {
        typeInto('#portal-name', 'Portal anterior');
    });
    await act(async () => {
        $<HTMLFormElement>('#portal-form').requestSubmit();
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => {
        await driveAuth.signOut();
    });
    gis.tokenResponse.access_token = 'another-account-token';
    await act(async () => {
        await driveAuth.signIn();
    });
    await act(async () => {
        release({id: 'old-portal', name: 'old', displayName: 'Portal anterior', url: '', revision: '1'});
    });
    expect(portals.value.some(portal => portal.id === 'old-portal')).toBe(false);
});
