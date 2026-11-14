import type {ExtractedFields} from '@domain/extract';

export interface AnalysisProgress {
    stage: 'text' | 'ocr';
    page: number;
    total: number;
    progress: number;
}

export interface PdfWorkerApi {
    analyze(file: File, vendorBase: string, onProgress: (event: AnalysisProgress) => void): Promise<ExtractedFields>;
}
