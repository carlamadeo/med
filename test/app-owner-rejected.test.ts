import {http, HttpResponse} from 'msw';
import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {$, mountPage, rowIds} from './page';
import {server} from './server';

it('rejects an unverifiable account and explains why the history remains closed', async () => {
    server.use(http.get('https://www.googleapis.com/drive/v3/about', () =>
        HttpResponse.json({user: {me: false}})
    ));
    await mountPage({signIn: false});
    await act(async () => {
        await driveAuth.signIn();
    });
    await vi.waitFor(() => expect($('#access-error')?.textContent).toContain('verificar la cuenta'));
    expect($('#library').hidden).toBe(true);
    expect(rowIds()).toEqual([]);
    expect(driveAuth.isSignedIn()).toBe(false);
});
