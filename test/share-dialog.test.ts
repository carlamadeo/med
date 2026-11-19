import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ShareDialog} from '@presentation/components/ShareDialog';
import {setSharingStudyId, setStudies} from '@presentation/state/store';
import {driveAuth, driveStudyRepo} from '@data';
import {mockAttachmentMetadata} from './mock-attachment-metadata';

const root = document.createElement('div');
beforeEach(() => { mockAttachmentMetadata(); });
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
    expect(share).toHaveBeenCalledExactlyOnceWith({url: 'https://example.org'});
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
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockResolvedValue(new File(['%PDF-prueba'], 'source.pdf', {type: 'application/pdf'}));
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

it('requires reviewing the selected version if the study refreshes while the dialog is open', async () => {
    const original = {
        id: 'one', driveFileId: 'one', title: 'Estudio', date: '2024-01-01',
        types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: 'informe.pdf',
        hasPdf: true, driveModifiedTime: '', revision: '1',
    };
    setStudies([original]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const loadAttachment = vi.spyOn(driveStudyRepo, 'getDocumentFile');
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {onReconnect: () => {}, error: null, busy: false, sessionLost: false}), root);
        setSharingStudyId('one');
    });
    await act(() => setStudies([{...original, revision: '2', reportName: 'otro.pdf'}]));
    await act(() => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(root.querySelector('#share-error')?.textContent).toContain('cambió en Drive'));
    expect(loadAttachment).not.toHaveBeenCalled();
    expect(root.querySelector('#share-send')).toBeNull();
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
    const loadAttachment = vi.spyOn(driveStudyRepo, 'getDocumentFile').mockResolvedValue(new File(['%PDF-prueba'], 'source.pdf', {type: 'application/pdf'}));
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
    expect(loadAttachment).toHaveBeenCalledTimes(1);
    expect(loadAttachment).toHaveBeenCalledWith('two', 'token');
    expect(root.textContent).toContain('elegido.pdf');
});

it('can prepare another study after closing while retrieval is in progress', async () => {
    const base = {
        title: 'Estudio', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '',
        viewer: '', hasPdf: true, driveModifiedTime: '', revision: '1',
    };
    setStudies([
        {...base, id: 'one', driveFileId: 'one', reportName: 'uno.pdf'},
        {...base, id: 'two', driveFileId: 'two', reportName: 'dos.pdf'},
    ]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const pdf = new File(['%PDF-prueba'], 'archivo.pdf', {type: 'application/pdf'});
    const delayed = Promise.withResolvers<File>();
    const retrieve = async (id: string) => id === 'one' ? delayed.promise : pdf;
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockImplementation(retrieve);
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {onReconnect: () => {}, error: null, busy: false, sessionLost: false}), root);
        setSharingStudyId('one');
    });
    const submit = () => act(() => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await submit();
    await vi.waitFor(() => expect(root.querySelector('#share-confirm')?.textContent).toContain('Preparando'));
    await act(() => root.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click());
    await act(() => setSharingStudyId('two'));
    const confirm = root.querySelector<HTMLButtonElement>('#share-confirm')!;
    expect(confirm.disabled).toBe(false);
    await submit();
    await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('dos.pdf'));
    await act(() => delayed.resolve(pdf));
    expect(root.querySelector('[role="status"]')?.textContent).toContain('dos.pdf');
});

it('shares a photo under its original image format', async () => {
    setStudies([{
        id: 'foto', driveFileId: 'foto', title: 'Informe fotografiado', date: '2024-03-18',
        types: ['Ecografía'], doctor: '', portal: '', viewer: '', reportName: 'informe.png',
        hasPdf: false, attachmentMime: 'image/png', driveModifiedTime: '', revision: '1',
    }]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'archivo.png', {type: 'image/png'});
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockResolvedValue(image);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {configurable: true, value: share});
    Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => true});
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {}, error: null, busy: false, sessionLost: false,
        }), root);
        setSharingStudyId('foto');
    });

    expect(root.querySelector<HTMLButtonElement>('#share-confirm')?.disabled).toBe(false);
    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(root.textContent).toContain('Listo para compartir'));
    await act(async () => root.querySelector<HTMLButtonElement>('#share-send')!.click());

    const shared = share.mock.calls[0]![0].files[0] as File;
    expect(shared.name).toBe('informe.png');
    expect(shared.type).toBe('image/png');
    expect(await shared.arrayBuffer()).toEqual(await image.arrayBuffer());
});
