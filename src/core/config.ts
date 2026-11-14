export const CONFIG = {
    // `GOOGLE_CLIENT_ID` is what the README and the Pages workflow set; `VITE_GOOGLE_CLIENT_ID` also works locally.
    GOOGLE_CLIENT_ID: String(import.meta.env.GOOGLE_CLIENT_ID ?? import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim(),
    DRIVE_FOLDER_NAME: 'mis-estudios',
    DRIVE_APP_PROPERTIES: {
        STUDY: 'estudio-v1',
        FOLDER: 'carpeta-v1',
    },
    PDF_MAX_PAGES_TEXT: 6,
    PDF_MAX_PAGES_OCR: 3,
    PDF_MAX_PAGES_SIGNATURE: 6,
    OCR_LANG: 'spa',
    CACHE_TTL_MS: 24 * 60 * 60 * 1000,
    ANALYSIS_TIMEOUT_MS: 45_000,
    SCANNED_THRESHOLD: 70,
} as const;

export type Config = typeof CONFIG;