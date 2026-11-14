/**
 * The PDF-reading flow of the editor, with the reader itself replaced by a controllable fake: what matters here is
 * what the form does with the result (fill empty fields, never overwrite the user, undo, time out, abort).
 * The reader's own logic is covered by extract.test.ts and the browser check against a real PDF.
 */
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import type * as PdfAnalysis from '@data/pdf-analysis';
import {analyzePdf} from '@data/pdf-analysis';
import {driveAuth} from '@data';
import type {ExtractedFields} from '@domain/extract';
import {resetFakeDrive} from './fake-drive';
import {$, TYPES, choose as chooseFile, closeDialogs, mountPage, reloadLibrary, typeInto} from './page';
import {editingStudy} from '@presentation/state/store';

vi.mock('@data/pdf-analysis', async (importOriginal) => {
    const actual = await importOriginal<typeof PdfAnalysis>();
    return {
        ...actual,
        analyzePdf: vi.fn(),
        validatePdf: vi.fn(async (file: File) => {
            if (file.size > 20 * 1024 * 1024) throw new Error('El archivo supera el límite de 20 MB.');
            const text = await file.text();
            if (!text.startsWith('%PDF-')) throw new Error('Elegí un archivo PDF válido.');
        }),
    };
});

const analyze = vi.mocked(analyzePdf);
const FOUND: ExtractedFields = {date: '2024-03-18', types: ['Ecografía', 'Mamografía'], doctor: 'Dra. Ana Pérez'};

const field = (name: string) => $<HTMLInputElement>(`#editor-form [name="${name}"]`);
const ticked = () => [...document.querySelectorAll<HTMLInputElement>('#study-types input:checked')].map((i) => i.value);
const status = () => $('#detection').textContent;
const editor = () => $<HTMLDialogElement>('#editor');
const choose = (file: File | null) => chooseFile('report', file);
const userTypes = typeInto;

async function accept(name: string) {
    await vi.waitFor(() => expect(document.querySelector(`[data-accept-suggestion="${name}"]`)).not.toBeNull());
    $<HTMLButtonElement>(`[data-accept-suggestion="${name}"]`).click();
}

function pdf(content = '%PDF-1.4 fake', name = 'informe.pdf') {
    return new File([content], name, {type: 'application/pdf'});
}

function openNew() {
    $<HTMLButtonElement>('[data-add]').click();
    expect(document.querySelectorAll('#study-types input')).toHaveLength(TYPES.length);
}

beforeAll(() => mountPage());

beforeEach(async () => {
    resetFakeDrive();
    analyze.mockReset();
    await reloadLibrary();
});

afterEach(() => {
    closeDialogs(); // also aborts any reading still running
    vi.useRealTimers();
});

describe('opening the editor', () => {
    it('starts a new study with an empty date and the PDF field focused', async () => {
        openNew();

        expect(field('date').value).toBe('');
        expect(document.activeElement).toBe(field('report'));
        expect(status()).toBe('Buscamos la fecha, los tipos y el médico en el PDF.');
    });
});

describe('reading a PDF', () => {
    it('shows the selected PDF and lets the user remove it before saving', async () => {
        let signal!: AbortSignal;
        analyze.mockImplementation((_file, abortSignal) => {
            signal = abortSignal;
            return new Promise<ExtractedFields>(() => {
            });
        });
        openNew();
        choose(pdf('%PDF-1.4 contenido', 'prueba.pdf'));
        await vi.waitFor(() => expect(document.querySelector('#selected-report')?.textContent).toContain('prueba.pdf'));
        expect(document.querySelector('#selected-report')?.textContent).toContain('bytes');
        await vi.waitFor(() => expect(analyze).toHaveBeenCalled());
        $<HTMLButtonElement>('[data-remove-selected-report]').click();
        await vi.waitFor(() => expect(document.querySelector('#selected-report')).toBeNull());
        expect(signal.aborted).toBe(true);
        expect(editor().open).toBe(true);
    });

    it('stops analyzing a private PDF when the session ends', async () => {
        let signal!: AbortSignal;
        analyze.mockImplementation((_file, abortSignal) => {
            signal = abortSignal;
            return new Promise<ExtractedFields>(() => {
            });
        });
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
        await driveAuth.signOut();
        await vi.waitFor(() => expect(signal.aborted).toBe(true));
    });

    it('keeps extracted values as proposals until individually accepted', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect(document.querySelector('#extraction-suggestions')?.textContent).toContain('2024-03-18'));
        expect(field('date').value).toBe('');
        expect(field('doctor').value).toBe('');
        $<HTMLButtonElement>('[data-accept-suggestion="date"]').click();
        expect(field('date').value).toBe('2024-03-18');
        expect(field('doctor').value).toBe('');
    });

    it('discards one proposal without changing other suggestions or typed values', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        userTypes('#editor-form [name="doctor"]', 'Mi profesional');
        choose(pdf());
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        const discard = [...document.querySelectorAll<HTMLButtonElement>('#extraction-suggestions button')].find((button) => button.textContent === 'Descartar médico')!;
        discard.click();
        expect(field('doctor').value).toBe('Mi profesional');
        await accept('date');
        expect(field('date').value).toBe('2024-03-18');
        expect(document.querySelector('[data-accept-suggestion="types"]')).not.toBeNull();
    });

    it('fills the empty fields and tells the user what to review', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();

        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        for (const name of ['date', 'types', 'doctor', 'title']) await accept(name);
        expect(field('date').value).toBe('2024-03-18');
        expect(ticked()).toEqual(['Ecografía', 'Mamografía']);
        expect(field('doctor').value).toBe('Dra. Ana Pérez');
        expect(field('title').value).toBe('Ecografía y mamografía');
        expect(status()).toBe('Revisá las sugerencias y aceptá las que correspondan.');
    });

    it('asks for what it could not find', async () => {
        analyze.mockResolvedValue({date: '2024-03-18'});
        openNew();

        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        expect(status()).toBe('Revisá las sugerencias y aceptá las que correspondan.');
        expect(ticked()).toEqual([]);
    });

    it('shows a progress message when it has to read an image', async () => {
        let finish!: (fields: ExtractedFields) => void;
        analyze.mockImplementation(async (_file, _signal, onScan) => {
            onScan();
            return new Promise<ExtractedFields>((resolve) => (finish = resolve));
        });
        openNew();

        choose(pdf());

        await vi.waitFor(() => expect(status()).toBe('Leyendo el texto de una imagen. Puede demorar unos segundos…'));
        finish(FOUND);
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
    });

    it('shows page progress and lets the user cancel without losing the attachment', async () => {
        let signal!: AbortSignal;
        analyze.mockImplementation(async (_file, abortSignal, _onScan, onProgress) => {
            signal = abortSignal;
            onProgress?.({stage: 'ocr', page: 2, total: 3, progress: 0.5});
            return new Promise((_resolve, reject) => {
                abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
            });
        });
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect(status()).toContain('2 de 3'));
        expect(document.querySelector('progress')?.getAttribute('value')).toBe('50');
        $<HTMLButtonElement>('[data-cancel-analysis]').click();
        expect(signal.aborted).toBe(true);
        await vi.waitFor(() => expect(status()).toContain('Lectura cancelada'));
        expect(field('report').files).toHaveLength(1);
        expect(field('date').value).toBe('');
        expect(document.querySelector('[data-cancel-analysis]')).toBeNull();
    });

    it('never overwrites a field the user already typed', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        userTypes('#editor-form [name="title"]', 'Mi título');

        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        expect(field('title').value).toBe('Mi título');
        await accept('date');
        expect(field('date').value).toBe('2024-03-18');
    });

    it('never overwrites a field the user typed and then emptied again', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        userTypes('#editor-form [name="doctor"]', 'x');
        userTypes('#editor-form [name="doctor"]', '');

        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        expect(field('doctor').value).toBe('');
    });

    it('treats ticking a type as the user choosing types', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        const other = document.querySelector<HTMLInputElement>('#study-types input[value="Otro"]')!;
        other.checked = true;
        other.dispatchEvent(new Event('input', {bubbles: true}));

        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        expect(ticked()).toEqual(['Otro']);
    });

    it('does not replace data of a study that is being edited', async () => {
        analyze.mockResolvedValue({date: '2020-01-01', types: ['Otro'], doctor: 'Otro Doctor'});
        $<HTMLButtonElement>('#results li[data-id="study-1"] .edit').click();
        await vi.waitFor(() => expect(field('title').value).toBe('Ecografía abdominal'));
        await vi.waitFor(() => expect(ticked()).toEqual(['Ecografía']));

        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        expect(field('date').value).toBe('2024-01-15');
        expect(field('doctor').value).toBe('Dra. Ana Pérez');
        expect(ticked()).toEqual(['Ecografía']);
        expect(status()).toBe('Revisá las sugerencias y aceptá las que correspondan.');
    });
});

describe('changing or removing the PDF', () => {
    it('takes back what the previous PDF suggested, but keeps what the user changed since', async () => {
        analyze.mockResolvedValueOnce(FOUND).mockResolvedValueOnce({});
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        for (const name of ['date', 'types', 'doctor', 'title']) await accept(name);
        userTypes('#editor-form [name="doctor"]', 'Dr. Escrito A Mano');

        choose(pdf('%PDF-1.4 otro', 'otro.pdf'));

        await vi.waitFor(() => expect(field('date').value).toBe(''));
        expect(ticked()).toEqual([]);
        expect(field('title').value).toBe('');
        expect(field('doctor').value).toBe('Dr. Escrito A Mano');
    });

    it('clears the suggestions when the file is removed', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        for (const name of ['date', 'types', 'doctor', 'title']) await accept(name);

        choose(null);

        expect(field('date').value).toBe('');
        expect(status()).toBe('Podés adjuntar un PDF o completar la ficha manualmente.');
    });

    it('ignores a slow result that arrives after a newer file was chosen', async () => {
        let finishSlow!: (fields: ExtractedFields) => void;
        let slowSignal!: AbortSignal;
        analyze
            .mockImplementationOnce((_file, signal) => {
                slowSignal = signal;
                return new Promise<ExtractedFields>((resolve) => (finishSlow = resolve));
            })
            .mockResolvedValueOnce({date: '2023-05-05'});
        openNew();

        choose(pdf('%PDF-1.4 uno', 'uno.pdf'));
        await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
        choose(pdf('%PDF-1.4 dos', 'dos.pdf'));
        await accept('date');
        expect(field('date').value).toBe('2023-05-05');
        expect(slowSignal.aborted).toBe(true); // the old reading is stopped, not just ignored
        finishSlow({date: '1999-09-09'});
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(field('date').value).toBe('2023-05-05');
    });
});

describe('when reading goes wrong', () => {
    it('rejects PDFs larger than 20 MB before analysis', async () => {
        openNew();
        const large = new File(['%PDF-', new Uint8Array(20 * 1024 * 1024)], 'grande.pdf', {type: 'application/pdf'});
        choose(large);
        await vi.waitFor(() => expect(status()).toContain('límite de 20 MB'));
        expect(analyze).not.toHaveBeenCalled();
        expect(document.querySelector('#selected-report')).toBeNull();
    });

    it('rejects a file that is not a PDF and clears the picker', async () => {
        openNew();

        choose(pdf('esto no es un pdf', 'falso.pdf'));

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('error'));
        expect(status()).toBe('Elegí un archivo PDF válido.');
        expect(analyze).not.toHaveBeenCalled();
        expect(field('report').value).toBe('');
    });

    it('tells the user to continue by hand when the PDF cannot be read', async () => {
        analyze.mockRejectedValue(new Error('corrupt'));
        openNew();

        choose(pdf());

        await vi.waitFor(() =>
            expect(status()).toBe('No pudimos leer el informe. Podés completar los campos y guardar el PDF.')
        );
        expect(field('date').value).toBe('');
    });

    it('gives up after 45 seconds and stops the reading', async () => {
        let signal!: AbortSignal;
        analyze.mockImplementation(
            (_file, abortSignal) =>
                new Promise<ExtractedFields>((_resolve, reject) => {
                    signal = abortSignal;
                    abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
                })
        );
        openNew();
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});

        choose(pdf());
        await vi.advanceTimersByTimeAsync(44_000);
        expect(status()).toBe('Leyendo el informe…');
        await vi.advanceTimersByTimeAsync(1_500);

        expect(status()).toBe('La lectura tardó demasiado. Podés completar los campos y guardar el PDF.');
        expect(signal.aborted).toBe(true);
    });

    it('stops reading when the editor is closed, and does not touch the form afterwards', async () => {
        let signal!: AbortSignal;
        let finish!: (fields: ExtractedFields) => void;
        analyze.mockImplementation((_file, abortSignal) => {
            signal = abortSignal;
            return new Promise<ExtractedFields>((resolve) => (finish = resolve));
        });
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect(analyze).toHaveBeenCalled());

        editor().close();
        finish(FOUND); // a late result must be ignored
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(signal.aborted).toBe(true);
        expect(field('date').value).toBe('');
    });

    it('forgets which fields were typed by hand in the previous session', async () => {
        openNew();
        userTypes('#editor-form [name="title"]', 'Escrito en la sesión anterior');
        editor().close();
        analyze.mockResolvedValue(FOUND);

        openNew();
        choose(pdf());

        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        await accept('title');
        expect(field('title').value).toBe('Ecografía y mamografía');
    });

    it('starts every new study with a clean slate', async () => {
        analyze.mockResolvedValue(FOUND);
        openNew();
        choose(pdf());
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        for (const name of ['date', 'types', 'doctor', 'title']) await accept(name);
        editor().close();
        // Wait for editor to fully close and editingStudy to clear
        await vi.waitFor(() => expect(editingStudy.value).toBeNull());

        openNew();

        expect(field('date').value).toBe('');
        expect(ticked()).toEqual([]);
        expect(status()).toBe('Buscamos la fecha, los tipos y el médico en el PDF.');
        // ... and the previous run's suggestions are not "taken back" from the fresh form:
        userTypes('#editor-form [name="title"]', 'Nuevo');
        analyze.mockResolvedValue({});
        choose(pdf('%PDF-1.4 x', 'x.pdf'));
        await vi.waitFor(() => expect($('#detection').dataset.state).toBe('review'));
        expect(field('title').value).toBe('Nuevo');
    });
});
