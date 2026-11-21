import {beforeEach, expect, it, vi} from 'vitest';
import {releaseProxy, wrap} from 'comlink';

vi.mock('comlink', () => {
    const releaseProxy = Symbol('releaseProxy');
    return {
        proxy: (callback: unknown) => callback,
        releaseProxy,
        wrap: vi.fn(),
    };
});

import {analyzePdf} from '@data/pdf-analysis';

class MockWorker {
    terminate = vi.fn();
    private listeners = new Map<string, EventListener[]>();

    addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    removeEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }
}

beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker);
});

it('analyzes a PDF worker, forwards progress and terminates the worker', async () => {
    const api = {
        analyze: vi.fn(async (_file: File, _base: string, progress: (event: unknown) => void) => {
            progress({stage: 'text', page: 1, total: 2, progress: 0});
            progress({stage: 'ocr', page: 2, total: 2, progress: 0.5});
            return {date: '2024-03-18', types: ['Ecografía'], doctor: 'Ana Perez'};
        }),
        [releaseProxy]: vi.fn(),
    };
    vi.mocked(wrap).mockReturnValue(api as never);
    const onScan = vi.fn();
    const onProgress = vi.fn();
    const controller = new AbortController();

    const result = await analyzePdf(
        new File(['%PDF-1.7'], 'informe.pdf', {type: 'application/pdf'}),
        controller.signal,
        onScan,
        onProgress,
    );

    expect(result).toEqual({date: '2024-03-18', types: ['Ecografía'], doctor: 'Ana Perez'});
    expect(onScan).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(wrap).toHaveBeenCalledOnce();
});

it('analyzes an image with OCR and forwards OCR progress', async () => {
    const api = {
        initialize: vi.fn(async (_base: string, progress: (value: number) => void) => {
            progress(0.75);
        }),
        recognize: vi.fn(async () => 'Estudio: Ecografia\nFecha: 18/03/2024\nMedico: Dra. Ana Perez'),
        [releaseProxy]: vi.fn(),
    };
    vi.mocked(wrap).mockReturnValue(api as never);
    const onScan = vi.fn();
    const onProgress = vi.fn();

    const result = await analyzePdf(
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'informe.png', {type: 'image/png'}),
        new AbortController().signal,
        onScan,
        onProgress,
    );

    expect(result).toMatchObject({date: '2024-03-18', types: ['Ecografía'], doctor: 'Ana Perez'});
    expect(onScan).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({stage: 'ocr', page: 1, total: 1, progress: 0.75});
});

it('rejects immediately when the PDF job is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(analyzePdf(
        new File(['%PDF-1.7'], 'informe.pdf', {type: 'application/pdf'}),
        controller.signal,
        vi.fn(),
    )).rejects.toHaveProperty('name', 'AbortError');
    expect(wrap).not.toHaveBeenCalled();
});

it('rejects and terminates when a PDF worker reports an error', async () => {
    const api = {
        analyze: vi.fn(() => new Promise((_resolve, reject) => reject(new Error('falló')))),
        [releaseProxy]: vi.fn(),
    };
    vi.mocked(wrap).mockReturnValue(api as never);

    await expect(analyzePdf(
        new File(['%PDF-1.7'], 'informe.pdf', {type: 'application/pdf'}),
        new AbortController().signal,
        vi.fn(),
    )).rejects.toThrow('falló');
});
