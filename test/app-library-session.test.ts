import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {gis} from './fake-google';
import {$, mountPage, typeInto} from './page';

it('clears library search and filters when another account signs in', async () => {
    await mountPage();
    const search = 'input[aria-label="Buscar estudios"]';
    await act(() => {
        typeInto(search, 'Informe privado');
        $('#categories [role="combobox"]')?.click();
    });
    await act(() => {
        $('#categories [role="option"]:not(.combobox-search-wrapper)')?.click();
    });

    await act(async () => {
        await driveAuth.signOut();
    });
    await vi.waitFor(() => expect($('#library').hidden).toBe(true));
    gis.tokenResponse.access_token = 'other-account-token';
    await act(async () => {
        await driveAuth.signIn();
    });
    await vi.waitFor(() => expect($('#library').hidden).toBe(false));

    expect($<HTMLInputElement>(search).value).toBe('');
    expect(document.querySelector('#categories .combobox-tag')).toBeNull();
});
