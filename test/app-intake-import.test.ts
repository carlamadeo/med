import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth, driveIntakeRepo, driveStudyRepo} from '@data';
import {Outbox} from '@data/outbox';
import * as pdfAnalysis from '@data/pdf-analysis';
import {approvedFolderId, intakeCandidates, pendingChanges, studiesReady, view} from '@presentation/state/store';
import {reserveIntakeDestination} from '@data/intake-reservations';
import {mountPage} from './page';

afterEach(() => {
    approvedFolderId.value = null;
    intakeCandidates.value = [];
    pendingChanges.value = [];
    localStorage.clear();
    vi.restoreAllMocks();
});

it('imports a candidate from the inbox, saves it with provenance, and resolves uncertain reservations without duplicates', async () => {
    await mountPage();
    await vi.waitFor(() => expect(studiesReady.value).toBe(true));

    const owner = driveAuth.cachedAccountId()!;
    const pdf = new File(['%PDF-1.4\n'], 'informe-qa.pdf', {type: 'application/pdf'});
    const candidate = {
        id: 'drive-src-1',
        name: 'informe-qa.pdf',
        mimeType: 'application/pdf',
        modifiedTime: '2026-11-10T12:00:00Z',
        size: 4,
        status: 'new' as const,
    };

    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate]);
    vi.spyOn(driveIntakeRepo, 'getPdfFile').mockResolvedValue(pdf);
    const analyze = vi.spyOn(pdfAnalysis, 'analyzePdf').mockResolvedValue({date: '2020-11-10'});

    await act(() => {
        approvedFolderId.value = 'approved-folder';
        view.value = 'intake';
    });

    await vi.waitFor(() => expect(document.body.textContent).toContain('informe-qa.pdf'));

    await act(async () => {
        const importButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'Importar');
        expect(importButton).toBeTruthy();
        importButton!.click();
    });

    await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('dialog#editor')?.open).toBe(true));

    const editor = document.querySelector<HTMLDialogElement>('dialog#editor')!;
    const form = editor.querySelector<HTMLFormElement>('form')!;
    const titleInput = form.elements.namedItem('title') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    await act(() => {
        titleInput.value = 'Informe QA Importado';
        titleInput.dispatchEvent(new Event('input', {bubbles: true}));
    });
    const dateInput = form.elements.namedItem('date') as HTMLInputElement;
    expect(dateInput.value).toBe('');
    const dateSuggestion = () => editor.querySelector<HTMLButtonElement>('[data-accept-suggestion="date"]');
    await vi.waitFor(() => expect(dateSuggestion()).not.toBeNull());
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(dateInput.value).toBe('');
    await act(() => dateSuggestion()!.click());
    expect(dateInput.value).toBe('2020-11-10');
    const trigger = form.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(() => {
        trigger.click();
    });
    const option = editor.querySelector<HTMLLIElement>('[role="option"]')!;
    await act(() => {
        option.click();
    });
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });

    await vi.waitFor(() => {
        const err = editor.querySelector('.form-error, [role="alert"]')?.textContent;
        if (err) throw new Error(`Editor error: ${err}`);
        expect(document.querySelector<HTMLDialogElement>('dialog#editor')?.open).toBe(false);
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Ya importado'));

    const savedStudies = await driveStudyRepo.list({force: true});
    const imported = savedStudies.find(study => study.intakeSourceId === 'drive-src-1');
    expect(imported).toBeTruthy();
    expect(imported?.title).toBe('Informe QA Importado');
    expect(imported?.date).toBe('2020-11-10');

    // Simulate an uncertain save for a second candidate where Drive already has the study
    const candidateTwo = {
        id: 'drive-src-2',
        name: 'pendiente-qa.pdf',
        mimeType: 'application/pdf',
        modifiedTime: '2026-11-11T12:00:00Z',
        size: 4,
        status: 'new' as const,
    };
    const reservedId = await reserveIntakeDestination(
        owner,
        candidateTwo.id,
        {
            title: 'Pendiente QA',
            date: '2026-11-11',
            types: ['Otro'],
            doctor: '',
            portal: '',
            viewer: '',
            reportName: 'pendiente-qa.pdf',
            file: pdf,
            intakeSourceId: candidateTwo.id,
        },
        () => driveStudyRepo.reserveId(),
    );

    vi.spyOn(driveIntakeRepo, 'listCandidates').mockResolvedValue([candidate, candidateTwo]);
    const refresh = () => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Actualizar'))!;
    const retry = () => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Verificar y reintentar'))!;
    await act(() => refresh().click());
    await vi.waitFor(() => expect(retry()).toBeTruthy());
    await act(() => retry().click());
    await vi.waitFor(() => expect(editor.open).toBe(true));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: (_: string, callback: () => Promise<unknown>) => callback()},
    });
    try {
        await act(async () => {
            form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        });
        await vi.waitFor(() => expect(editor.textContent).toContain('confirmar el guardado anterior'));
        expect(await new Outbox().list(owner)).toEqual([]);
    } finally {
        online.mockRestore();
        if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
        else Reflect.deleteProperty(navigator, 'locks');
    }
    await act(() => editor.close());

    await driveStudyRepo.save({
        id: reservedId,
        title: 'Pendiente QA',
        date: '2026-11-11',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: 'pendiente-qa.pdf',
        file: pdf,
        intakeSourceId: candidateTwo.id,
    });

    await act(() => refresh().click());

    await vi.waitFor(() => expect(document.body.textContent).toContain('Guardados sin confirmar'));
    await act(() => retry().click());

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('Guardados sin confirmar'));
    const allWithSourceTwo = (await driveStudyRepo.list({force: true})).filter(study => study.intakeSourceId === candidateTwo.id);
    expect(allWithSourceTwo).toHaveLength(1);
    expect(allWithSourceTwo[0]?.id).toBe(reservedId);
});
