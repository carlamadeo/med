import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import JSZip from 'jszip';
import {driveAuth, driveStudyRepo} from '@data';
import {ExportDialog} from '@presentation/components/ExportDialog';
import {setExporting, setStudies, setExportScope, operations} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    root.remove();
    setExporting(false);
    setStudies([]);
    setExportScope('all');
    operations.value = [];
    vi.restoreAllMocks();
});

it('allows the user to select and start an export when the dialog opens', async () => {
    setStudies([{
        id: 'one',
        title: 'Estudio',
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveFileId: 'one',
        driveModifiedTime: '',
        revision: '1'
    }]);
    document.body.append(root);
    await act(() => {
        render(h(ExportDialog, {
            onReconnect: () => {
            }, error: null, sessionLost: false
        }), root);
        setExporting(true);
    });
    expect(root.querySelector<HTMLButtonElement>('#export-confirm')!.disabled).toBe(false);
    expect(root.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
});

it('exports authenticated PDF bytes using the study ID and limits filtered scope', async () => {
    setStudies([{
        id: 'one',
        title: 'Estudio',
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: 'informe.pdf',
        hasPdf: true,
        driveFileId: 'one',
        driveModifiedTime: '',
        revision: '1'
    }]);
    setExportScope('filtered');
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveAuth, 'getAccountId').mockResolvedValue('owner');
    const getPdf = vi.spyOn(driveStudyRepo, 'getPdfFile').mockResolvedValue(new File(['contenido'], 'informe.pdf', {type: 'application/pdf'}));
    const createUrl = vi.fn().mockReturnValue('blob:test');
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createUrl});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    });
    document.body.append(root);
    await act(() => {
        render(h(ExportDialog, {
            onReconnect: () => {
            }, error: null, sessionLost: false
        }), root);
        setExporting(true);
    });
    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledOnce());
    const zip = await JSZip.loadAsync(await (createUrl.mock.calls[0]![0] as Blob).arrayBuffer());
    expect(getPdf).toHaveBeenCalledWith('one');
    expect(await zip.file('pdfs/one.pdf')!.async('text')).toBe('contenido');
    expect(JSON.parse(await zip.file('manifest.json')!.async('text'))).toMatchObject({version: 1, scope: 'filtered'});
    expect(zip.file('operations.json')).toBeNull();
});

it('does not download an export when the account changes while preparing it', async () => {
    setStudies([{
        id: 'one',
        title: 'Estudio',
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveFileId: 'one',
        driveModifiedTime: '',
        revision: '1'
    }]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValueOnce('first').mockResolvedValue('second');
    vi.spyOn(driveAuth, 'getAccountId').mockResolvedValue('owner');
    const createUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createUrl});
    document.body.append(root);
    await act(() => {
        render(h(ExportDialog, {
            onReconnect: () => {
            }, error: null, sessionLost: false
        }), root);
        setExporting(true);
    });
    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(root.textContent).toContain('La cuenta cambió'));
    expect(createUrl).not.toHaveBeenCalled();
});
