import {useEffect, useRef, useState} from 'preact/hooks';
import {
    exporting,
    exportError,
    setExporting,
    setExportError,
    studies,
    filteredStudies,
    libraryHasFilters,
    view,
    operations,
    portals,
    medicalEvents,
    episodes,
    appointments,
    pendingChanges,
    directoryWarning,
    directoriesReady,
    studiesReady,
    syncing,
} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';
import {driveAuth, driveStudyRepo, DriveSessionError} from '@data';
import {Outbox} from '@data/outbox';
import {selectExportSnapshot, type ExportScope, type ExportSnapshot} from '@domain/export-scope';

const outbox = new Outbox();
const pendingMessage = 'Sincronizá los cambios pendientes antes de exportar.';
const accountChangedMessage = 'La cuenta cambió durante la exportación. Volvé a intentarlo.';

function getExportBlocker(owner = driveAuth.cachedAccountId()): string | null {
    if (directoryWarning.value) {
        return 'No se pudieron cargar todos los registros. Actualizá la página antes de exportar.';
    }
    if (!studiesReady.value || !directoriesReady.value) {
        return 'Esperá a que termine la carga de todos los registros. Si no termina, actualizá la página.';
    }
    if (syncing.value || pendingChanges.value.some(entry => entry.owner === owner)) return pendingMessage;
    return null;
}

async function assertExportReady(owner: string): Promise<void> {
    const queued = await outbox.list(owner);
    const blocker = getExportBlocker(owner);
    if (blocker || queued.length) throw new Error(blocker ?? pendingMessage);
}

async function assertExportToken(token: string): Promise<void> {
    if (await driveAuth.getAccessToken() !== token) throw new Error(accountChangedMessage);
}

function readExportSnapshot(): ExportSnapshot {
    return {
        studies: studies.value,
        operations: operations.value,
        portals: portals.value,
        medicalEvents: medicalEvents.value,
        episodes: episodes.value,
        appointments: appointments.value,
    };
}

interface ExportDialogProps {
    onReconnect: () => void;
    error: string | null;
    sessionLost: boolean;
}

function formatDateForFilename(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function ExportDialog({onReconnect, error, sessionLost}: ExportDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const previewRef = useRef('');
    const isExporting = exporting.value;
    const expError = exportError.value;

    const [includeAttachments, setIncludeAttachments] = useState(true);
    const [includeViewerLinks, setIncludeViewerLinks] = useState(true);
    const [filename, setFilename] = useState(`mis-estudios-${formatDateForFilename()}.zip`);
    const [busy, setBusy] = useState(false);
    const [scope, setScope] = useState<ExportScope>('all');

    useFocusTrap(dialogRef, isExporting);

    useEffect(() => {
        const element = dialogRef.current;
        if (!element) return;
        if (isExporting && !element.open) {
            const initialScope = (view.value === 'cronologia' || view.value === 'categoria') && libraryHasFilters.value ? 'filtered' : 'all';
            setScope(initialScope);
            previewRef.current = JSON.stringify([readExportSnapshot(), initialScope === 'filtered' ? filteredStudies.value : null]);
            element.showModal();
            element.querySelector<HTMLElement>('#export-title')?.focus();
        } else if (!isExporting && element.open) element.close();
    }, [isExporting]);

    const handleClose = () => {
        dialogRef.current?.close();
        setExporting(false);
        setExportError(null);

        if (pendingChanges.value.length || directoryWarning.value) {
            setExportError('Sincronizá los cambios pendientes y cargá todos los registros antes de exportar.');
            return;
        }
    };

    const getStudiesToExport = () => {
        return scope === 'filtered' ? filteredStudies.value : studies.value;
    };

    const handleConfirm = async () => {
        if (sessionLost || !exporting.value) return;
        setExportError(null);

        const signature = JSON.stringify([readExportSnapshot(), scope === 'filtered' ? filteredStudies.value : null]);
        if (previewRef.current !== signature) {
            previewRef.current = signature;
            setExportError('Los datos cambiaron. Revisá la selección y volvé a confirmar.');
            return;
        }
        const studiesToExport = getStudiesToExport();
        const hasOtherRecords = operations.value.length > 0 || portals.value.length > 0 || medicalEvents.value.length > 0 || episodes.value.length > 0 || appointments.value.length > 0;
        if (studiesToExport.length === 0 && (scope === 'filtered' || !hasOtherRecords)) {
            setExportError('No hay registros para exportar');
            return;
        }

        const selectedStudies = studiesToExport.filter(s => !s.syncStatus);
        if (selectedStudies.length !== studiesToExport.length) {
            setExportError('No se pueden exportar estudios con cambios pendientes');
            return;
        }

        const current = readExportSnapshot();
        const snapshot = selectExportSnapshot(current, scope, new Set(selectedStudies.map(study => study.id)));
        try {
            setBusy(true);
            const token = await driveAuth.getAccessToken();
            const owner = await driveAuth.getAccountId();
            await assertExportReady(owner);
            const zip = await createExportZip(snapshot, scope, includeAttachments, includeViewerLinks, token);
            await assertExportReady(owner);
            if (await driveAuth.getAccessToken() !== token || await driveAuth.getAccountId() !== owner) {
                throw new Error('La cuenta cambió durante la exportación. Volvé a intentarlo.');
            }
            downloadBlob(zip, filename);
            handleClose();
        } catch (err) {
            setExportError(err instanceof Error ? err.message : 'Error al crear la exportación');
        } finally {
            setBusy(false);
        }
    };

    const hasOtherRecords = operations.value.length > 0 || portals.value.length > 0 || medicalEvents.value.length > 0 || episodes.value.length > 0 || appointments.value.length > 0;
    const studyCount = getStudiesToExport().length;
    const hasRecords = studyCount > 0 || (scope === 'all' && hasOtherRecords);
    const preview = selectExportSnapshot(readExportSnapshot(), scope, new Set(filteredStudies.value.map(study => study.id)));
    const attachmentCount = preview.studies.filter(study => study.hasPdf || study.attachmentMime).length;
    const blocker = isExporting && !sessionLost ? getExportBlocker() : null;
    const message = error || expError || blocker;

    return (
        <dialog
            id="export"
            ref={dialogRef}
            className="dialog export-dialog"
            aria-labelledby="export-title"
            aria-describedby="export-copy export-summary"
            data-busy={String(busy)}
            onCancel={(event) => {
                if (busy) event.preventDefault(); else handleClose();
            }}
        >
            <form id="export-form" onSubmit={(event) => {
                event.preventDefault();
                if (!busy) void handleConfirm();
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Archivo</p>
                        <h2 id="export-title" tabIndex={-1}>Exportar historia</h2>
                        <p id="export-copy" className="export-desc">Descargá una copia portable de tus registros.</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Cerrar" disabled={busy}
                            onClick={handleClose}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                <p className="form-error export-error" id="export-error" role="alert"
                   hidden={!message}>{message}</p>

                <button type="button" className="button secondary export-reconnect" hidden={!sessionLost}
                        onClick={onReconnect}>
                    Reconectar Google Drive
                </button>

                <div className="export-summary" id="export-summary">
                    <span className="export-summary-icon"><svg className="icon"><use href="#i-download"/></svg></span>
                    <div>
                        <strong>{studyCount} {studyCount === 1 ? 'estudio' : 'estudios'}</strong>
                        <span>{includeAttachments ? attachmentCount : 0} archivos adjuntos · {preview.operations.length} operaciones · {preview.portals.length} portales · {preview.medicalEvents.length} consultas y recetas · {preview.episodes.length} episodios · {preview.appointments.length} turnos.</span>
                    </div>
                </div>

                <fieldset className="export-section" disabled={busy || sessionLost}>
                    <legend>Qué exportar</legend>
                    <div className="export-options">
                        <label className="export-option">
                            <input type="radio" name="export-scope" value="all" checked={scope === 'all'} onChange={() => { setScope('all'); previewRef.current = JSON.stringify([readExportSnapshot(), null]); }}/>
                            <span>Todos los estudios <small>{studies.value.length}</small></span>
                        </label>
                        {libraryHasFilters.value && (view.value === 'cronologia' || view.value === 'categoria') && <label className="export-option">
                            <input type="radio" name="export-scope" value="filtered" checked={scope === 'filtered'} onChange={() => { setScope('filtered'); previewRef.current = JSON.stringify([readExportSnapshot(), filteredStudies.value]); }}/>
                            <span>Resultados filtrados <small>{filteredStudies.value.length}</small></span>
                        </label>}
                    </div>
                </fieldset>

                <p className="export-note">{scope === 'all' ? 'La exportación incluye todos los estudios y sus entidades relacionadas.' : 'Incluye los estudios filtrados y los registros vinculados directamente.'}</p>

                <fieldset className="export-section" disabled={busy || sessionLost}>
                    <legend>Contenido a incluir</legend>
                    <div className="export-options">
                        <label className="export-option">
                            <input type="checkbox" checked={includeAttachments}
                                   onChange={(e) => setIncludeAttachments(e.currentTarget.checked)}/>
                            <svg className="icon">
                                <use href="#i-file"/>
                            </svg>
                            <span>Archivos PDF e imágenes (JPEG y PNG)</span>
                        </label>
                        <label className="export-option">
                            <input type="checkbox" checked={includeViewerLinks}
                                   onChange={(e) => setIncludeViewerLinks(e.currentTarget.checked)}/>
                            <svg className="icon">
                                <use href="#i-external"/>
                            </svg>
                            <span>Enlaces a visores y portales</span>
                        </label>
                    </div>
                </fieldset>

                <label className="export-filename">
                    Nombre del archivo
                    <input type="text" value={filename} onInput={(e) => setFilename(e.currentTarget.value)}
                           placeholder="mis-estudios-2024-01-15.zip" maxLength={120} disabled={busy || sessionLost}/>
                    <span className="hint">La exportación se descargará como un archivo ZIP.</span>
                </label>

                <div className="dialog-actions">
                    <button type="button" className="button quiet" disabled={busy} onClick={handleClose}>Cancelar
                    </button>
                    <button type="submit" className="button primary" id="export-confirm"
                            disabled={busy || sessionLost || !hasRecords || Boolean(blocker)}>
                        {busy ? 'Exportando…' : 'Exportar'}
                    </button>
                </div>
            </form>
        </dialog>
    );
}

async function createExportZip(
    snapshot: ExportSnapshot,
    scope: ExportScope,
    includeAttachments: boolean,
    includeViewerLinks: boolean,
    token: string,
): Promise<Blob> {
    const {default: JSZip} = await import('jszip');
    const zip = new JSZip();

    const manifest = {
        version: 1,
        scope,
        exportedAt: new Date().toISOString(),
        totalStudies: snapshot.studies.length,
        studies: snapshot.studies.map(s => ({
            id: s.id,
            title: s.title,
            date: s.date,
            types: s.types,
            doctor: s.doctor,
            portal: s.portal,
            viewer: includeViewerLinks ? s.viewer : '',
            reportName: s.reportName,
            hasPdf: s.hasPdf,
            attachmentMime: s.attachmentMime,
            operationId: s.operationId,
            documentIds: s.documentIds,
        }))
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const operationsList = snapshot.operations.map(op => ({
        id: op.id,
        name: op.name,
        date: op.date,
        surgeon: op.surgeon,
        institution: op.institution,
        type: op.type,
        notes: op.notes,
        studyIds: op.studyIds,
    }));
    zip.file('operations.json', JSON.stringify(operationsList, null, 2));

    const portalsList = snapshot.portals.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        url: includeViewerLinks ? p.url : '',
        notes: p.notes,
    }));
    zip.file('portals.json', JSON.stringify(portalsList, null, 2));

    const eventsList = snapshot.medicalEvents.map(e => ({
        id: e.id,
        kind: e.kind,
        date: e.date,
        doctor: e.doctor,
        notes: e.notes,
        studyIds: e.studyIds,
        documentIds: e.documentIds,
    }));
    zip.file('medical-events.json', JSON.stringify(eventsList, null, 2));

    zip.file('episodes.json', JSON.stringify(snapshot.episodes, null, 2));
    zip.file('appointments.json', JSON.stringify(snapshot.appointments, null, 2));

    if (includeViewerLinks) {
        const viewerLinks = snapshot.studies.filter(study => study.viewer)
            .map(study => `${study.title} (${study.date}): ${study.viewer}`);
        if (viewerLinks.length > 0) zip.file('viewer-links.txt', viewerLinks.join('\n\n'));
    }

    if (includeAttachments) {
        zip.folder('pdfs');
        for (const study of snapshot.studies) {
            const mime = study.attachmentMime;
            if (!mime && !study.hasPdf) continue;
            await assertExportToken(token);
            try {
                if (mime) {
                    const image = await driveStudyRepo.getDocumentFile(study.driveFileId, token);
                    if (image.type !== mime) throw new Error('Formato de imagen inesperado.');
                    zip.file(`images/${study.id}.${mime === 'image/png' ? 'png' : 'jpg'}`, await image.arrayBuffer());
                } else {
                    const pdf = await driveStudyRepo.getPdfFile(study.driveFileId, token);
                    zip.file(`pdfs/${study.id}.pdf`, await pdf.arrayBuffer());
                }
            } catch (err) {
                if (err instanceof DriveSessionError) throw err;
                throw new Error(`No se pudo incluir el archivo de «${study.title}». Revisá la conexión y volvé a intentar.`);
            }
        }
    }

    return zip.generateAsync({type: 'blob', compression: 'DEFLATE', compressionOptions: {level: 6}});
}