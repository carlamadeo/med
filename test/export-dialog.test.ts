import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import JSZip from 'jszip';
import {driveAuth, driveStudyRepo} from '@data';
import {Outbox} from '@data/outbox';
import type {Study} from '@domain/models';
import {ExportDialog} from '@presentation/components/ExportDialog';
import {
    appointments, categoryTypes, directoryWarning, episodes, medicalEvents, operations,
    portals, directoriesReady, studiesReady, setExportError, setExporting, setStudies,
} from '@presentation/state/store';

const root = document.createElement('div');
const outbox = new Outbox();

function study(id: string, fields: Partial<Study> = {}): Study {
    return {
        id, title: 'Estudio de prueba', date: '2024-01-01', types: ['Otro'],
        doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false,
        driveFileId: id, driveModifiedTime: '', revision: '1',
        ...fields,
    };
}

async function openDialog() {
    document.body.append(root);
    await act(() => {
        render(h(ExportDialog, {onReconnect: () => {}, error: null, sessionLost: false}), root);
        setExporting(true);
    });
}

async function submit() {
    await act(() => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
}

function captureDownload() {
    const createUrl = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:test');
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createUrl});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    return createUrl;
}

async function downloadedZip(createUrl: ReturnType<typeof captureDownload>) {
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledOnce());
    return JSZip.loadAsync(await createUrl.mock.calls[0]![0].arrayBuffer());
}

beforeEach(() => {
    studiesReady.value = true;
    directoriesReady.value = true;
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveAuth, 'getAccountId').mockResolvedValue('owner');
});

afterEach(async () => {
    render(null, root);
    root.remove();
    setExporting(false);
    setExportError(null);
    setStudies([]);
    categoryTypes.value = [];
    studiesReady.value = false;
    directoriesReady.value = false;
    directoryWarning.value = false;
    operations.value = [];
    portals.value = [];
    medicalEvents.value = [];
    episodes.value = [];
    appointments.value = [];
    for (const owner of ['owner', 'other-owner']) {
        for (const entry of await outbox.list(owner)) {
            await outbox.discard(owner, entry.id!);
        }
    }
    vi.restoreAllMocks();
});

it('allows the user to select and start an export when the dialog opens', async () => {
    setStudies([study('one')]);
    await openDialog();
    expect(root.querySelector<HTMLButtonElement>('#export-confirm')!.disabled).toBe(false);
    expect(root.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
});

it('exports every study and preserves the legacy PDF path and bytes', async () => {
    setStudies([
        study('one', {types: ['Ecografía'], hasPdf: true, reportName: 'informe.pdf'}),
        study('two', {types: ['Otro']}),
    ]);
    vi.spyOn(driveStudyRepo, 'getPdfFile').mockResolvedValue(new File(['contenido'], 'informe.pdf', {type: 'application/pdf'}));
    const createUrl = captureDownload();
    await openDialog();
    expect(root.querySelector('#export-summary')?.textContent).toContain('2 estudios');
    await submit();

    const zip = await downloadedZip(createUrl);
    expect(await zip.file('pdfs/one.pdf')!.async('text')).toBe('contenido');
    expect(JSON.parse(await zip.file('manifest.json')!.async('text'))).toMatchObject({
        version: 1, scope: 'all', totalStudies: 2, studies: [{id: 'one'}, {id: 'two'}],
    });
    expect(zip.file('operations.json')).not.toBeNull();
});

it('keeps one snapshot of related records while fetching attachments', async () => {
    setStudies([study('one', {hasPdf: true, operationId: 'op1'})]);
    operations.value = [{id: 'op1', name: 'Operación inicial', color: '', studyIds: ['one']}];
    portals.value = [{id: 'portal1', name: 'portal', displayName: 'Portal inicial', url: 'https://example.com'}];
    medicalEvents.value = [{
        id: 'event1', kind: 'consultation', date: '2024-01-01', doctor: '', notes: '',
        studyIds: ['one'], documentIds: [], revision: '1',
    }];
    episodes.value = [{id: 'episode1', illness: 'Episodio inicial', observations: [], medications: [], revision: '1'}];
    appointments.value = [{
        id: 'appointment1', revision: '1', date: '2024-01-01', time: '12:00', timeZone: 'America/Argentina/Buenos_Aires',
        professional: 'Profesional', notes: '', status: 'scheduled', cost: null, coverage: null,
    }];
    vi.spyOn(driveStudyRepo, 'getPdfFile').mockImplementation(async () => {
        operations.value = [];
        portals.value = [];
        medicalEvents.value = [];
        episodes.value = [];
        appointments.value = [];
        return new File(['contenido'], 'informe.pdf', {type: 'application/pdf'});
    });
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    const zip = await downloadedZip(createUrl);
    for (const [path, id] of [
        ['operations.json', 'op1'], ['portals.json', 'portal1'], ['medical-events.json', 'event1'],
        ['episodes.json', 'episode1'], ['appointments.json', 'appointment1'],
    ] as const) {
        expect(JSON.parse(await zip.file(path)!.async('text'))).toMatchObject([{id}]);
    }
});

it('includes JPEG and PNG bytes with extensions and MIME metadata matching the stored attachments', async () => {
    setStudies([
        study('jpeg', {attachmentMime: 'image/jpeg', reportName: 'foto.jpg'}),
        study('png', {attachmentMime: 'image/png', reportName: 'foto.png'}),
    ]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockImplementation(async (id) => {
        if (id === 'jpeg') return new File([jpeg], 'foto.jpg', {type: 'image/jpeg'});
        if (id === 'png') return new File([png], 'foto.png', {type: 'image/png'});
        throw new Error('Unexpected attachment');
    });
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    const zip = await downloadedZip(createUrl);
    expect(zip.file('images/jpeg.jpg')).not.toBeNull();
    expect(zip.file('images/png.png')).not.toBeNull();
    expect(await zip.file('images/jpeg.jpg')!.async('uint8array')).toEqual(jpeg);
    expect(await zip.file('images/png.png')!.async('uint8array')).toEqual(png);
    expect(JSON.parse(await zip.file('manifest.json')!.async('text'))).toMatchObject({
        studies: [{id: 'jpeg', attachmentMime: 'image/jpeg'}, {id: 'png', attachmentMime: 'image/png'}],
    });
});

it('omits optional attachments and viewer links from the ZIP when deselected', async () => {
    setStudies([study('one', {hasPdf: true, viewer: 'https://example.com/viewer'})]);
    const createUrl = captureDownload();
    await openDialog();
    act(() => root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.click()));
    await submit();

    const zip = await downloadedZip(createUrl);
    expect(zip.file('pdfs/one.pdf')).toBeNull();
    expect(zip.file('viewer-links.txt')).toBeNull();
    expect(JSON.parse(await zip.file('manifest.json')!.async('text'))).toMatchObject({studies: [{viewer: ''}]});
});

it('blocks download after a partial directory load', async () => {
    setStudies([study('one')]);
    directoryWarning.value = true;
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    await vi.waitFor(() => expect(root.querySelector('#export-error')?.textContent).toContain('cargar todos los registros'));
    expect(createUrl).not.toHaveBeenCalled();
});

it('blocks download for a pending change in the account even before its outbox UI is ready', async () => {
    setStudies([study('one')]);
    await outbox.enqueueEpisodeDelete('owner', 'episode1', '1');
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    await vi.waitFor(() => expect(root.querySelector('#export-error')?.textContent).toContain('cambios pendientes'));
    expect(createUrl).not.toHaveBeenCalled();
});

it('allows export when changes are queued for a different account', async () => {
    setStudies([study('one')]);
    await outbox.enqueueEpisodeDelete('other-owner', 'episode1', '1');
    const createUrl = captureDownload();
    await openDialog();
    await submit();

const zip = await downloadedZip(createUrl);
    expect(JSON.parse(await zip.file('manifest.json')!.async('text'))).toMatchObject({
        version: 1, scope: 'all', totalStudies: 1, studies: [{id: 'one'}],
    });
    expect(zip.file('operations.json')).not.toBeNull();
});

it('does not download an export when the account changes while preparing it', async () => {
    setStudies([study('one', {hasPdf: true}), study('two', {hasPdf: true})]);
    const getPdf = vi.spyOn(driveStudyRepo, 'getPdfFile').mockImplementation(async () => {
        vi.mocked(driveAuth.getAccessToken).mockResolvedValue('second');
        return new File(['contenido'], 'informe.pdf', {type: 'application/pdf'});
    });
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    await vi.waitFor(() => expect(root.textContent).toContain('La cuenta cambió'));
    expect(createUrl).not.toHaveBeenCalled();
    expect(getPdf).toHaveBeenCalledExactlyOnceWith('one', 'token');
});

it('blocks download when a change is queued during attachment retrieval', async () => {
    setStudies([study('one', {hasPdf: true})]);
    vi.spyOn(driveStudyRepo, 'getPdfFile').mockImplementation(async () => {
        await outbox.enqueueEpisodeDelete('owner', 'episode1', '1');
        return new File(['contenido'], 'informe.pdf', {type: 'application/pdf'});
    });
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    await vi.waitFor(() => expect(root.querySelector('#export-error')?.textContent).toContain('cambios pendientes'));
    expect(createUrl).not.toHaveBeenCalled();
});

it('keeps the dialog open without downloading if a selected attachment is unavailable', async () => {
    setStudies([study('one', {attachmentMime: 'image/png'})]);
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockRejectedValue(new Error('Archivo no disponible'));
    const createUrl = captureDownload();
    await openDialog();
    await submit();

    await vi.waitFor(() => expect(root.querySelector('#export-error')?.textContent).toContain('Estudio de prueba'));
    expect(createUrl).not.toHaveBeenCalled();
    expect(root.querySelector('dialog')?.open).toBe(true);
});

it('exports only filtered studies and directly related records', async () => {
    const store = await import('@presentation/state/store');
    store.view.value = 'cronologia';
    store.libraryPortal.value = 'Clínica Norte';
    setStudies([
        study('one', {portal: 'Clinica Norte', hasPdf: true, operationId: 'op', documentIds: ['two']}),
        study('two', {portal: 'Otra', hasPdf: true}),
    ]);
    operations.value = [{id: 'op', name: 'Operación', color: '', studyIds: []}];
    portals.value = [{id: 'p', name: 'Clínica Norte', displayName: 'Norte', url: 'https://example.com'}];
    medicalEvents.value = [
        {id: 'linked', kind: 'consultation', date: '2024-01-01', doctor: '', notes: '', studyIds: ['one', 'two'], documentIds: ['two'], revision: '1'},
        {id: 'other', kind: 'consultation', date: '2024-01-01', doctor: '', notes: '', studyIds: ['two'], documentIds: [], revision: '1'},
    ];
    const getPdf = vi.spyOn(driveStudyRepo, 'getPdfFile').mockResolvedValue(new File(['contenido'], 'informe.pdf', {type: 'application/pdf'}));
    const createUrl = captureDownload();
    await openDialog();
    expect(root.querySelector<HTMLInputElement>('input[value=filtered]')?.checked).toBe(true);
    await submit();
    const zip = await downloadedZip(createUrl);
    expect(JSON.parse(await zip.file('manifest.json')!.async('text'))).toMatchObject({scope: 'filtered', totalStudies: 1, studies: [{id: 'one', documentIds: []}]});
    expect(JSON.parse(await zip.file('medical-events.json')!.async('text'))).toMatchObject([{id: 'linked', studyIds: ['one'], documentIds: []}]);
    expect(zip.file('pdfs/two.pdf')).toBeNull();
    expect(getPdf).toHaveBeenCalledOnce();
    store.resetLibraryFilters();
    store.view.value = 'resumen';
});

it('requires confirmation again if records change while the export dialog is open', async () => {
    setStudies([study('one')]);
    const createUrl = captureDownload();
    await openDialog();
    await act(() => setStudies([study('one'), study('two')]));
    await submit();
    expect(createUrl).not.toHaveBeenCalled();
    expect(root.querySelector('#export-error')?.textContent).toContain('Los datos cambiaron');
    await submit();
    const zip = await downloadedZip(createUrl);
    expect(JSON.parse(await zip.file('manifest.json')!.async('text')).totalStudies).toBe(2);
});
