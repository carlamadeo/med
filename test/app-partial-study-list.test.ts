import {expect, it, vi} from 'vitest';
import {driveStudyRepo} from '@data';
import {addRemoteRaw, fakeDriveFile} from './fake-drive';
import {mountPage} from './page';

it('keeps valid and historical studies available when Drive has an unreadable record', async () => {
    addRemoteRaw('legacy-study', {title: 'Estudio histórico', type: 'Ecografía'});
    addRemoteRaw('unreadable-study', {types: []});
    const unreadable = structuredClone(fakeDriveFile('unreadable-study'));

    await mountPage();

    await vi.waitFor(() => {
        expect(document.querySelector('.library-table')?.textContent ?? '').toContain('Estudio histórico');
        expect(document.querySelector('[role="status"].offline-notice')?.textContent).toContain('No se pudo leer una ficha de Drive.');
    });
    await expect(driveStudyRepo.list({force: true})).rejects.toThrow(/ficha/i);
    expect(fakeDriveFile('unreadable-study')).toEqual(unreadable);
    expect(unreadable?.trashed).toBe(false);

    addRemoteRaw('unreadable-study', {title: 'Ficha corregida', types: ['Ecografía']});
    document.querySelector<HTMLButtonElement>('[role="status"].offline-notice button')?.click();
    await vi.waitFor(() => {
        expect(document.querySelector('.library-table')?.textContent ?? '').toContain('Ficha corregida');
        expect(document.querySelector('[role="status"].offline-notice')).toBeNull();
    });
});
