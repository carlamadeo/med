import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {ShareDialog} from '@presentation/components/ShareDialog';
import {setSharingStudyId, setStudies} from '@presentation/state/store';
import {driveAuth, driveStudyRepo} from '@data';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    root.remove();
    setSharingStudyId(null);
    setStudies([]);
    vi.restoreAllMocks();
});

it('shares only the selected link when the study has an associated PDF', async () => {
    const base = {
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        reportName: 'informe.pdf',
        driveModifiedTime: '',
        revision: '1'
    };
    setStudies([
        {
            ...base,
            id: 'one',
            driveFileId: 'one',
            title: 'Estudio',
            hasPdf: false,
            viewer: 'https://example.org',
            documentIds: ['two']
        },
        {...base, id: 'two', driveFileId: 'two', title: 'PDF', hasPdf: true, viewer: ''},
    ]);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {configurable: true, value: share});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['pdf']), {status: 200}));
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false
        }), root);
        setSharingStudyId('one');
    });
    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({url: 'https://example.org'}));
    expect(share.mock.calls[0]![0]).not.toHaveProperty('files');
});

it('prepares the PDF before a separate user action invokes the share menu', async () => {
    setStudies([{
        id: 'one',
        driveFileId: 'one',
        title: 'Estudio',
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: 'informe.pdf',
        hasPdf: true,
        driveModifiedTime: '',
        revision: '1'
    }]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveStudyRepo, 'getPdfFile').mockResolvedValue(new File(['PDF'], 'source.pdf', {type: 'application/pdf'}));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {configurable: true, value: share});
    Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => true});
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false
        }), root);
        setSharingStudyId('one');
    });
    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(root.textContent).toContain('Listo para compartir'));
    expect(share).not.toHaveBeenCalled();
    await act(async () => {
        root.querySelector<HTMLButtonElement>('#share-send')!.click();
    });
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0]![0].files[0].name).toBe('informe.pdf');
});

it('prepares only associated documents explicitly selected by the user', async () => {
    const base = {
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: 'informe.pdf',
        driveModifiedTime: '',
        revision: '1'
    };
    setStudies([
        {...base, id: 'one', driveFileId: 'one', title: 'Estudio', hasPdf: false, documentIds: ['two', 'three']},
        {...base, id: 'two', driveFileId: 'two', title: 'Elegido', reportName: 'elegido.pdf', hasPdf: true},
        {...base, id: 'three', driveFileId: 'three', title: 'No elegido', reportName: 'otro.pdf', hasPdf: true},
    ]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const getPdf = vi.spyOn(driveStudyRepo, 'getPdfFile').mockResolvedValue(new File(['PDF'], 'source.pdf', {type: 'application/pdf'}));
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false
        }), root);
        setSharingStudyId('one');
    });
    const checkbox = root.querySelector<HTMLInputElement>('input[value="two"]')!;
    await act(() => {
        checkbox.click();
    });
    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(root.textContent).toContain('Listo para compartir'));
    expect(getPdf).toHaveBeenCalledTimes(1);
    expect(getPdf).toHaveBeenCalledWith('two');
    expect(root.textContent).toContain('elegido.pdf');
});
