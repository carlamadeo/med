import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import JSZip from 'jszip';
import {ShareDialog} from '@presentation/components/ShareDialog';
import {
    isSourceUnavailable,
    setSharingStudyId,
    setSharingStudyIds,
    setStudies,
    unavailableSources
} from '@presentation/state/store';
import {DriveError, driveAuth, driveStudyRepo} from '@data';
import {mockAttachmentMetadata} from './mock-attachment-metadata';

const root = document.createElement('div');
beforeEach(() => {
    mockAttachmentMetadata();
});
afterEach(() => {
    render(null, root);
    root.remove();
    setSharingStudyId(null);
    setStudies([]);
    unavailableSources.value = new Set();
    vi.restoreAllMocks();
});

it('opens printing from single-study sharing only when the study has an attachment', async () => {
    const base = {
        date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', reportName: '',
        driveModifiedTime: '', revision: '1', viewer: 'https://example.org'
    };
    const attached = {...base, id: 'pdf', driveFileId: 'pdf', title: 'Informe', hasPdf: true};
    setStudies([attached, {...base, id: 'link', driveFileId: 'link', title: 'Visor', hasPdf: false}]);
    const onPrint = vi.fn(() => expect(root.querySelector('dialog[open]')).toBeNull());
    const print = () => [...root.querySelectorAll('button')].find(button => button.textContent === 'Imprimir archivo');
    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, onPrint, error: null, busy: false, sessionLost: false
        }), root);
        setSharingStudyId('link');
    });
    expect(print()).toBeUndefined();
    expect(root.querySelector('#share-confirm')).not.toBeNull();
    await act(() => setSharingStudyIds(['pdf', 'link']));
    expect(print()).toBeUndefined();
    await act(() => setSharingStudyId('pdf'));
    await act(() => print()!.click());
    expect(onPrint).toHaveBeenCalledWith(attached);
});

it('keeps the report printable after a missing associated document or a temporary download failure', async () => {
    const base = {
        date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', reportName: 'informe.pdf',
        driveModifiedTime: '', revision: '1', viewer: '', hasPdf: true
    };
    setStudies([
        {...base, id: 'report', driveFileId: 'report', title: 'Informe', documentIds: ['annex']},
        {...base, id: 'annex', driveFileId: 'annex', title: 'Anexo'},
    ]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const download = vi.spyOn(driveStudyRepo, 'getDocumentFile').mockImplementation(async id => {
        if (id === 'annex') throw new DriveError(404);
        return new File(['%PDF-prueba'], 'informe.pdf', {type: 'application/pdf'});
    });
    document.body.append(root);
    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, onPrint: () => {
            }, error: null, busy: false, sessionLost: false
        }), root);
        setSharingStudyId('report');
    });
    await act(() => root.querySelector<HTMLInputElement>('input[value="annex"]')!.click());
    const submit = () => act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await submit();
    await vi.waitFor(() => expect(root.querySelector('#share-error')?.textContent).toContain('No se pudo descargar'));
    expect(isSourceUnavailable('annex')).toBe(true);
    expect(isSourceUnavailable('report')).toBe(false);
    expect(root.textContent).toContain('Imprimir archivo');

    download.mockRejectedValueOnce(new DriveError(503));
    await act(() => root.querySelector<HTMLInputElement>('input[value="annex"]')!.click());
    await submit();
    expect(isSourceUnavailable('report')).toBe(false);
    expect(root.textContent).toContain('Imprimir archivo');
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
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false
        }), root);
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
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false
        }), root);
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
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false,
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

it('shares multiple selected studies, lets user toggle each source and deduplicates filenames', async () => {
    const base = {
        date: '2024-03-10',
        types: ['Otro'],
        doctor: '',
        portal: '',
        driveModifiedTime: '',
        revision: '1',
    };
    setStudies([
        {
            ...base,
            id: 'one',
            driveFileId: 'one',
            title: 'Análisis',
            reportName: 'informe.pdf',
            hasPdf: true,
            viewer: 'https://visor.test/1',
            documentIds: ['doc-1'],
        },
        {
            ...base,
            id: 'two',
            driveFileId: 'two',
            title: 'Ecografía',
            reportName: 'informe.pdf',
            hasPdf: true,
            viewer: '',
        },
        {
            ...base,
            id: 'doc-1',
            driveFileId: 'doc-1',
            title: 'Anexo',
            reportName: 'anexo.pdf',
            hasPdf: true,
            viewer: '',
        },
    ]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockImplementation(async (id) =>
        new File([`%PDF-${id}`], `${id}.pdf`, {type: 'application/pdf'}),
    );
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {configurable: true, value: share});
    Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => true});
    document.body.append(root);

    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false,
        }), root);
        setSharingStudyIds(['one', 'two']);
    });

    expect(root.querySelector('#share-title')?.textContent).toBe('Compartir estudios');
    expect(root.querySelector('#share-copy')?.textContent).toBe('2 estudios seleccionados');

    const viewerOne = root.querySelector<HTMLInputElement>('input[data-share-study="one"][data-share-kind="viewer"]')!;
    const docOne = root.querySelector<HTMLInputElement>('input[value="one:doc-1"]')!;
    expect(viewerOne.checked).toBe(false);
    expect(docOne.checked).toBe(false);

    await act(() => {
        viewerOne.click();
        docOne.click();
    });

    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });

    await vi.waitFor(() => expect(root.textContent).toContain('Listo para compartir'));
    expect(root.textContent).toContain('informe.pdf, anexo.pdf, informe-2.pdf');

    await act(async () => root.querySelector<HTMLButtonElement>('#share-send')!.click());

    expect(share).toHaveBeenCalledOnce();
    const payload = share.mock.calls[0]![0];
    expect(payload.url).toBe('https://visor.test/1');
    expect(payload.files.map((file: File) => file.name)).toEqual(['informe.pdf', 'anexo.pdf', 'informe-2.pdf']);
});

it('creates a ZIP with all prepared files and viewer links when multiple files are prepared', async () => {
    const base = {
        date: '2024-03-10',
        types: ['Otro'],
        doctor: '',
        portal: '',
        driveModifiedTime: '',
        revision: '1',
    };
    setStudies([
        {
            ...base,
            id: 'one',
            driveFileId: 'one',
            title: 'Laboratorio',
            reportName: 'uno.pdf',
            hasPdf: true,
            viewer: 'https://visor.test/1',
        },
        {
            ...base,
            id: 'two',
            driveFileId: 'two',
            title: 'Radiografía',
            reportName: 'foto.png',
            hasPdf: false,
            attachmentMime: 'image/png',
            viewer: '',
        },
    ]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const pdfBytes = '%PDF-uno';
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    vi.spyOn(driveStudyRepo, 'getDocumentFile').mockImplementation(async (id) =>
        id === 'one'
            ? new File([pdfBytes], 'uno.pdf', {type: 'application/pdf'})
            : new File([pngBytes], 'foto.png', {type: 'image/png'}),
    );
    const createUrl = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:zip-test');
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createUrl});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    });
    document.body.append(root);

    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false,
        }), root);
        setSharingStudyIds(['one', 'two']);
    });

    await act(() => {
        root.querySelector<HTMLInputElement>('input[data-share-study="one"][data-share-kind="viewer"]')!.click();
    });

    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });

    await vi.waitFor(() => expect(root.querySelector('#share-download-zip')).not.toBeNull());
    await act(async () => {
        root.querySelector<HTMLButtonElement>('#share-download-zip')!.click();
    });

    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledOnce());
    const downloadedFile = createUrl.mock.calls[0]![0] as File;
    expect(downloadedFile.name).toBe('estudios-compartidos.zip');
    const zip = await JSZip.loadAsync(await downloadedFile.arrayBuffer());
    expect(await zip.file('uno.pdf')!.async('text')).toBe(pdfBytes);
    expect(new Uint8Array(await zip.file('foto.png')!.async('uint8array'))).toEqual(pngBytes);
    expect(await zip.file('enlaces.txt')!.async('text')).toContain('Laboratorio: https://visor.test/1');
});

it('combines multiple selected viewer links in ShareData.text and WhatsApp/email links', async () => {
    const base = {
        date: '2024-03-10',
        types: ['Otro'],
        doctor: '',
        portal: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1',
    };
    setStudies([
        {...base, id: 'one', driveFileId: 'one', title: 'Estudio A', viewer: 'https://visor.test/1'},
        {...base, id: 'two', driveFileId: 'two', title: 'Estudio B', viewer: 'https://visor.test/2'},
    ]);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {configurable: true, value: share});
    document.body.append(root);

    await act(() => {
        render(h(ShareDialog, {
            onReconnect: () => {
            }, error: null, busy: false, sessionLost: false,
        }), root);
        setSharingStudyIds(['one', 'two']);
    });

    const expectedText = 'Estudio A: https://visor.test/1\nEstudio B: https://visor.test/2';
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.share-links a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
        `https://wa.me/?text=${encodeURIComponent(expectedText)}`,
        `mailto:?body=${encodeURIComponent(expectedText)}`,
    ]);

    await act(async () => {
        root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });

    expect(share).toHaveBeenCalledExactlyOnceWith({text: expectedText});
});
