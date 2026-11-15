import {act} from 'preact/test-utils';
import {http, HttpResponse} from 'msw';
import {expect, it, vi} from 'vitest';
import {fakeDriveFile} from './fake-drive';
import {$, mountPage} from './page';
import {server} from './server';
import {__testOnlySetTypes, __testOnlyClearTypes} from '@presentation/components/EditorDialog';

async function setTypesInEditor(types: string[]) {
    await act(async () => {
        __testOnlySetTypes((fn) => {
            if (fn) fn(types);
        });
    });
    await new Promise(r => setTimeout(r, 50));
}

it('reuses the reserved ID after a failed upload', async () => {
    await mountPage();
    let attempts = 0;
    server.use(http.post('https://www.googleapis.com/upload/drive/v3/files', () => {
        if (++attempts === 1) return new HttpResponse(null, {status: 500});
        return undefined;
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await act(() => {
        $<HTMLButtonElement>('[data-add]').click();
    });
    const form = $<HTMLFormElement>('#editor-form');
    await act(async () => {
        const title = form.elements.namedItem('title') as HTMLInputElement;
        const date = form.elements.namedItem('date') as HTMLInputElement;
        title.value = 'Con reintento';
        title.dispatchEvent(new Event('input', {bubbles: true}));
        date.value = '2024-01-01';
        date.dispatchEvent(new Event('input', {bubbles: true}));
        await setTypesInEditor(['Otro']);
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
    await act(() => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(fakeDriveFile('generated-1')).toBeDefined());
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('generateIds'))).toHaveLength(1);
    __testOnlyClearTypes();
});

it('does not save a draft after the session changes during ID reservation', async () => {
    const {driveAuth, driveStudyRepo} = await import('@data');
    const {gis} = await import('./fake-google');
    await mountPage();
    let release!: (id: string) => void;
    const reserve = vi.spyOn(driveStudyRepo, 'reserveId').mockImplementation(() => new Promise(resolve => {
        release = resolve;
    }));
    const save = vi.spyOn(driveStudyRepo, 'save');
    await act(() => {
        $<HTMLButtonElement>('[data-add]').click();
    });
    const form = $<HTMLFormElement>('#editor-form');
    await act(async () => {
        const title = form.elements.namedItem('title') as HTMLInputElement;
        const date = form.elements.namedItem('date') as HTMLInputElement;
        title.value = 'Borrador';
        title.dispatchEvent(new Event('input', {bubbles: true}));
        date.value = '2024-01-01';
        date.dispatchEvent(new Event('input', {bubbles: true}));
        await setTypesInEditor(['Otro']);
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(reserve).toHaveBeenCalledOnce());
    await act(async () => {
        await driveAuth.signOut();
    });
    gis.tokenResponse.access_token = 'another-account-token';
    await act(async () => {
        await driveAuth.signIn();
    });
    await act(async () => {
        release('reserved-id');
    });
    expect(save).not.toHaveBeenCalled();
    __testOnlyClearTypes();
});
