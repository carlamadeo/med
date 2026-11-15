import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {driveStudyRepo} from '@data';
import type * as PdfAnalysis from '@data/pdf-analysis';
import {$, choose, mountPage, typeInto} from './page';

vi.mock('@data/pdf-analysis', async (importOriginal) => ({
    ...await importOriginal<typeof PdfAnalysis>(),
    analyzePdf: async () => ({date: '2024-03-18', types: ['Ecografía'], doctor: 'Dra. Pérez'}),
}));

it('reviews camera suggestions and saves the original image as a study', async () => {
    await mountPage();
    const photoBytes = new Uint8Array([255, 216, 255, 224]);
    const photo = new File([photoBytes], 'informe.jpg', {type: 'image/jpeg'});

    act(() => $('button[data-add]').click());
    const camera = $<HTMLInputElement>('#editor input[name="camera-report"]');
    expect(camera?.getAttribute('capture')).toBe('environment');
    act(() => choose(camera.name, photo));

    await vi.waitFor(() => expect($('[data-accept-suggestion="date"]')).not.toBeNull());
    expect($<HTMLInputElement>('#editor-date-field').value).toBe('');
    act(() => {
        typeInto('#editor-title-field', 'Informe fotografiado');
        $('[data-accept-suggestion="date"]').click();
        $('[data-accept-suggestion="types"]').click();
    });
    await act(async () => {
        $('#editor-form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });

    await vi.waitFor(() => expect($<HTMLDialogElement>('#editor').open).toBe(false));
    const stored = (await driveStudyRepo.list({force: true})).find((item) => item.title === 'Informe fotografiado');
    expect(stored).toMatchObject({
        date: '2024-03-18', types: ['Ecografía'], doctor: '', hasPdf: false,
        attachmentMime: 'image/jpeg', reportName: 'informe.jpg',
    });
    const storedPhoto = await driveStudyRepo.getDocumentFile(stored!.driveFileId);
    expect(storedPhoto.type).toBe('image/jpeg');
    expect(new Uint8Array(await storedPhoto.arrayBuffer())).toEqual(photoBytes);

    act(() => $('button[data-add]').click());
    expect($('[aria-label="Sugerencias de lectura"]')).toBeNull();
});
