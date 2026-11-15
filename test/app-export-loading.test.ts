import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {drivePortalRepo} from '@data';
import {$, mountPage} from './page';

it('waits for the first directory load even when studies have already loaded', async () => {
    let resolvePortals!: (portals: []) => void;
    const list = vi.spyOn(drivePortalRepo, 'list').mockImplementation(() => new Promise(resolve => {
        resolvePortals = resolve;
    }));
    await mountPage();
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());

    await act(() => {
        $<HTMLButtonElement>('#export-history').click();
    });
    const confirm = $<HTMLButtonElement>('#export-confirm');
    expect(confirm.disabled).toBe(true);

    await act(() => resolvePortals([]));
    await vi.waitFor(() => expect(confirm.disabled).toBe(false));
});
