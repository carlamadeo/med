import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth, driveClient, driveIntakeRepo} from '@data';
import {IntakeCandidates} from '@presentation/components/IntakeCandidates';
import {FolderPickerDialog} from '@presentation/components/FolderPickerDialog';
import {approvedFolderId, intakeCandidates, isFolderPickerOpen, setIntakeCandidates} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    root.remove();
    approvedFolderId.value = null;
    isFolderPickerOpen.value = false;
    setIntakeCandidates([]);
    vi.restoreAllMocks();
});

it('keeps a candidate available when opening it for review', async () => {
    const candidate = {
        id: 'source',
        name: 'informe.pdf',
        mimeType: 'application/pdf',
        modifiedTime: '2024-01-01',
        size: 8,
        status: 'new' as const
    };
    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate]);
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveAuth, 'cachedAccountId').mockReturnValue('owner');
    const file = new File(['PDF'], 'informe.pdf', {type: 'application/pdf'});
    vi.spyOn(driveIntakeRepo, 'getPdfFile').mockResolvedValue(file);
    const onOpenEditor = vi.fn();
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => {
        render(h(IntakeCandidates, {onOpenEditor}), root);
    });
    await vi.waitFor(() => expect(root.textContent).toContain('informe.pdf'));
    await act(async () => {
        [...root.querySelectorAll('button')].find(button => button.textContent === 'Importar')!.click();
    });
    await vi.waitFor(() => expect(onOpenEditor).toHaveBeenCalledWith(expect.objectContaining({
        _candidateId: 'source',
        file
    })));
    expect(intakeCandidates.value[0]?.status).toBe('new');
});

it('does not open a downloaded candidate after the Drive account changes', async () => {
    const candidate = {
        id: 'source',
        name: 'informe.pdf',
        mimeType: 'application/pdf',
        modifiedTime: '2024-01-01',
        size: 8,
        status: 'new' as const
    };
    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate]);
    let token = 'first';
    vi.spyOn(driveAuth, 'getAccessToken').mockImplementation(async () => token);
    vi.spyOn(driveAuth, 'cachedAccountId').mockImplementation(() => token);
    let finish!: (file: File) => void;
    vi.spyOn(driveIntakeRepo, 'getPdfFile').mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    const onOpenEditor = vi.fn();
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => {
        render(h(IntakeCandidates, {onOpenEditor}), root);
    });
    await vi.waitFor(() => expect(root.textContent).toContain('informe.pdf'));
    await act(() => {
        [...root.querySelectorAll('button')].find(button => button.textContent === 'Importar')!.click();
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    token = 'second';
    await act(async () => {
        finish(new File(['PDF'], 'informe.pdf', {type: 'application/pdf'}));
    });
    expect(onOpenEditor).not.toHaveBeenCalled();
});


it('filters candidates by file name', async () => {
    const candidates = [
        {
            id: 'a',
            name: 'informe-laboratorio.pdf',
            mimeType: 'application/pdf',
            modifiedTime: '2026-11-10',
            size: 8,
            status: 'new' as const
        },
        {
            id: 'b',
            name: 'receta-completa.pdf',
            mimeType: 'application/pdf',
            modifiedTime: '2026-11-08',
            size: 8,
            status: 'new' as const
        },
    ];
    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue(candidates);
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => {
        render(h(IntakeCandidates, {onOpenEditor: vi.fn()}), root);
    });
    await vi.waitFor(() => expect(root.textContent).toContain('receta-completa.pdf'));

    const input = root.querySelector<HTMLInputElement>('#intake-search')!;
    await act(async () => {
        input.value = 'receta';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });

    await vi.waitFor(() => expect(root.textContent).not.toContain('informe-laboratorio.pdf'));
    expect(root.textContent).toContain('receta-completa.pdf');
});

it('actualiza la lista desde Drive al solicitar una actualización', async () => {
    const candidate = {id: 'new', name: 'nuevo.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-01', size: 8, status: 'new' as const};
    const list = vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValueOnce([]).mockResolvedValueOnce([candidate]);
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => render(h(IntakeCandidates, {onOpenEditor: vi.fn()}), root));
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await act(() => [...root.querySelectorAll('button')].find(button => button.textContent?.includes('Actualizar'))!.click());
    await vi.waitFor(() => expect(root.textContent).toContain('nuevo.pdf'));
});

it('muestra el nombre y tamaño devueltos por Drive aunque la descripción sea texto libre', async () => {
    const {DriveIntakeRepository} = await import('@data/drive-intake-repository');
    const {storage} = await import('@core/storage');
    vi.spyOn(storage, 'readSessionDirectory').mockResolvedValue(null);
    const request = vi.fn().mockResolvedValue({json: async () => ({files: [{id: 'one', name: 'estudio.pdf', description: 'descripción libre', mimeType: 'application/pdf', size: '624', modifiedTime: '2024-01-01'}]})});
    const client = {cacheOwner: async () => 'owner', request, url: (_base: string, _path: string, params: Record<string, string>) => {
        expect(params.fields).toContain('name');
        expect(params.fields).toContain('size');
        return 'https://example.com';
    }};
    const repo = new DriveIntakeRepository(client as never);
    await expect(repo.listCandidates('folder')).resolves.toEqual([expect.objectContaining({name: 'estudio.pdf', size: 624})]);
});

it('excluye los PDF ya guardados por la aplicación de una carpeta de origen', async () => {
    const {DriveIntakeRepository} = await import('@data/drive-intake-repository');
    const {storage} = await import('@core/storage');
    vi.spyOn(storage, 'readSessionDirectory').mockResolvedValue(null);
    const pdf = {name: 'informe.pdf', mimeType: 'application/pdf', size: '624'};
    const request = vi.fn().mockResolvedValue({json: async () => ({files: [
        {...pdf, id: 'own-file', appProperties: {misEstudios: 'estudio-v1'}},
        {...pdf, id: 'external-file'},
    ]})});
    const client = {cacheOwner: async () => 'owner', request, url: () => 'https://example.com'};
    const repo = new DriveIntakeRepository(client as never);
    await expect(repo.listCandidates('folder')).resolves.toEqual([expect.objectContaining({id: 'external-file'})]);
});

it('ofrece carpetas externas y excluye la carpeta de destino marcada por la aplicación', async () => {
    vi.spyOn(driveAuth, 'isSignedIn').mockReturnValue(true);
    vi.spyOn(driveClient, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveAuth, 'getAccountId').mockResolvedValue('owner');
    vi.spyOn(driveClient, 'request').mockResolvedValue(Response.json({files: [
        {id: 'destination', name: 'Archivo', appProperties: {misEstudios: 'carpeta-v1'}},
        {id: 'external', name: 'Archivo'},
    ]}));
    document.body.append(root);
    await act(() => render(h(FolderPickerDialog, {}), root));
    await act(() => { isFolderPickerOpen.value = true; });
    await vi.waitFor(() => expect(root.querySelector('[role="option"]')).not.toBeNull());
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(1);
});

it('verifica una reserva antigua contra el estudio guardado en Drive', async () => {
    const {driveStudyRepo} = await import('@data');
    const {studies} = await import('@presentation/state/store');
    const candidate = {id: 'source-old', name: 'informe.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-01', size: 8, status: 'new' as const};
    const study = {id: 'reserved-old', driveFileId: 'reserved-old', intakeSourceId: candidate.id, title: 'Informe guardado', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: 'informe.pdf', hasPdf: true, driveModifiedTime: '', revision: '1'};
    localStorage.setItem('mis-estudios:intake-reservation:owner:source-old', JSON.stringify({id: 'reserved-old', fingerprint: 'old'}));
    vi.spyOn(driveAuth, 'cachedAccountId').mockReturnValue('owner');
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate]);
    vi.spyOn(driveStudyRepo, 'list').mockResolvedValue([study]);
    const open = vi.fn();
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => render(h(IntakeCandidates, {onOpenEditor: open}), root));
    await vi.waitFor(() => expect(root.textContent).toContain('Verificar y reintentar'));
    await act(() => [...root.querySelectorAll('button')].find(button => button.textContent === 'Verificar y reintentar')!.click());
    await vi.waitFor(() => expect(studies.value.some(item => item.id === 'reserved-old')).toBe(true));
    expect(localStorage.getItem('mis-estudios:intake-reservation:owner:source-old')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    studies.value = [];
});

it('conserva la reserva y no abre el editor si cambia la cuenta al verificar Drive', async () => {
    const {driveStudyRepo} = await import('@data');
    const {studies} = await import('@presentation/state/store');
    const candidate = {id: 'source-switch', name: 'informe.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-01', size: 8, status: 'new' as const};
    const reservationKey = 'mis-estudios:intake-reservation:first:source-switch';
    localStorage.setItem(reservationKey, JSON.stringify({id: 'reserved', fingerprint: 'old'}));
    let account = 'first';
    vi.spyOn(driveAuth, 'cachedAccountId').mockImplementation(() => account);
    vi.spyOn(driveAuth, 'getAccessToken').mockImplementation(async () => account);
    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate]);
    let finish!: (value: Awaited<ReturnType<typeof driveStudyRepo.list>>) => void;
    const list = vi.spyOn(driveStudyRepo, 'list').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const open = vi.fn();
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => render(h(IntakeCandidates, {onOpenEditor: open}), root));
    await vi.waitFor(() => expect(root.textContent).toContain('Verificar y reintentar'));
    await act(() => [...root.querySelectorAll('button')].find(button => button.textContent === 'Verificar y reintentar')!.click());
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    account = 'second';
    await act(async () => finish([{id: 'reserved', driveFileId: 'reserved', intakeSourceId: candidate.id, title: 'Informe', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'}]));
    expect(localStorage.getItem(reservationKey)).not.toBeNull();
    expect(studies.value.some(study => study.id === 'reserved')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    localStorage.removeItem(reservationKey);
});

it('no confirma una ficha cuyo origen difiere del archivo reservado', async () => {
    const {driveStudyRepo} = await import('@data');
    const {studies} = await import('@presentation/state/store');
    const candidate = {id: 'source-mismatch', name: 'informe.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-01', size: 8, status: 'new' as const};
    const reservationKey = 'mis-estudios:intake-reservation:owner:source-mismatch';
    localStorage.setItem(reservationKey, JSON.stringify({id: 'reserved-mismatch', fingerprint: 'old'}));
    vi.spyOn(driveAuth, 'cachedAccountId').mockReturnValue('owner');
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate]);
    vi.spyOn(driveStudyRepo, 'list').mockResolvedValue([{id: 'reserved-mismatch', driveFileId: 'reserved-mismatch', intakeSourceId: 'otro', title: 'Otro informe', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'}]);
    vi.spyOn(driveIntakeRepo, 'getPdfFile').mockResolvedValue(new File(['PDF'], 'informe.pdf', {type: 'application/pdf'}));
    const open = vi.fn();
    document.body.append(root);
    approvedFolderId.value = 'folder';
    await act(() => render(h(IntakeCandidates, {onOpenEditor: open}), root));
    await vi.waitFor(() => expect(root.textContent).toContain('Verificar y reintentar'));
    await act(() => [...root.querySelectorAll('button')].find(button => button.textContent === 'Verificar y reintentar')!.click());
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(localStorage.getItem(reservationKey)).not.toBeNull();
    expect(studies.value.some(study => study.id === 'reserved-mismatch')).toBe(false);
    localStorage.removeItem(reservationKey);
});
