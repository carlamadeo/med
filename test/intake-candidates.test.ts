import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth, driveIntakeRepo} from '@data';
import {IntakeCandidates} from '@presentation/components/IntakeCandidates';
import {approvedFolderId, intakeCandidates, setIntakeCandidates} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    root.remove();
    approvedFolderId.value = null;
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
