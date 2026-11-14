/** If the catalogue cannot be fetched the page cannot work, and it says so instead of failing silently. */
import {http, HttpResponse} from 'msw';
import {expect, it, vi} from 'vitest';
import {$, mountPage} from './page';

it('disables connecting and asks the user to reload', async () => {
    await mountPage({
        signIn: false,
        types: http.get('*/types.json', () => new HttpResponse('not json', {status: 500}))
    });

    await vi.waitFor(() => expect($<HTMLButtonElement>('#connect').disabled).toBe(true));
    expect($('#access-copy').textContent).toBe('No se pudo cargar la página. Actualizala para volver a intentar.');
    expect($<HTMLButtonElement>('[data-add]').disabled).toBe(true);
});
