import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {fakeDriveFile} from './fake-drive';
import {$, mountPage, rowIds} from './page';

it('links and unlinks an existing PDF without changing or duplicating it', async () => {
    await mountPage();
    await vi.waitFor(() => expect(rowIds()).toContain('study-2'));
    const edit = () => act(() => {
        document.querySelector<HTMLButtonElement>('#results li[data-id="study-2"] .edit')!.click();
    });
    edit();
    act(() => {
        $<HTMLInputElement>('[name="documentIds"][value="study-1"]').click();
    });
    act(() => {
        $<HTMLInputElement>('#study-types input[value=Otro]').click();
    });
    await act(async () => {
        $<HTMLFormElement>('#editor-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#results li[data-id="study-2"]')?.textContent).toContain('PDF asociado: Informe.pdf'));
    expect(fakeDriveFile('study-1')?.version).toBe(1);
    edit();
    act(() => {
        $<HTMLInputElement>('[name="documentIds"][value="study-1"]').click();
    });
    await act(async () => {
        $<HTMLFormElement>('#editor-form').requestSubmit();
    });
    await vi.waitFor(() => expect(document.querySelector('#results li[data-id="study-2"]')?.textContent).not.toContain('PDF asociado'));
    expect(fakeDriveFile('study-1')?.trashed).toBe(false);
});
