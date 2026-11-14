import {useEffect, useRef, useState} from 'preact/hooks';
import {
    exporting,
    exportError,
    setExporting,
    setExportError,
    visibleStudies,
    operations,
    portals,
    medicalEvents,
    episodes,
    appointments,
    pendingChanges,
    directoryWarning
} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';
import {driveAuth, driveStudyRepo} from '@data';
import type {Study} from '@domain/models';

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
    const isExporting = exporting.value;
    const expError = exportError.value;

    const [includePdfs, setIncludePdfs] = useState(true);
    const [includeViewerLinks, setIncludeViewerLinks] = useState(true);
    const [filename, setFilename] = useState(`mis-estudios-${formatDateForFilename()}.zip`);
    const [busy, setBusy] = useState(false);

    useFocusTrap(dialogRef, isExporting);

    useEffect(() => {
        const element = dialogRef.current;
        if (!element) return;
        if (isExporting && !element.open) {
            element.showModal();
            element.querySelector<HTMLButtonElement>('.quiet')?.focus();
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

    const handleCancel = () => {
        handleClose();
    };

    const getStudiesToExport = () => {
        return visibleStudies.value;
    };

    const handleConfirm = async () => {
        setExportError(null);

        const studiesToExport = getStudiesToExport();
        if (studiesToExport.length === 0 && !hasOtherRecords) {
            setExportError('No hay registros para exportar');
            return;
        }

        const selectedStudies = studiesToExport.filter(s => !s.syncStatus);
        if (selectedStudies.length !== studiesToExport.length) {
            setExportError('No se pueden exportar estudios con cambios pendientes');
            return;
        }

        try {
            setBusy(true);
            const token = await driveAuth.getAccessToken();
            const owner = await driveAuth.getAccountId();
            const zip = await createExportZip(selectedStudies, includePdfs, includeViewerLinks);
            if (await driveAuth.getAccessToken() !== token || await driveAuth.getAccountId() !== owner) {
                throw new Error('La cuenta cambió durante la exportación. Volvé a intentarlo.');
            }
            downloadBlob(zip, filename);
        } catch (err) {
            setExportError(err instanceof Error ? err.message : 'Error al crear la exportación');
            return;
        } finally {
            setBusy(false);
        }

        handleClose();
    };

    const hasOtherRecords = operations.value.length > 0 || portals.value.length > 0 || medicalEvents.value.length > 0 || episodes.value.length > 0 || appointments.value.length > 0;
    const hasRecords = getStudiesToExport().length > 0 || hasOtherRecords;

    return (
        <dialog
            id="export"
            ref={dialogRef}
            className="dialog export-dialog"
            aria-labelledby="export-title"
            aria-describedby="export-copy export-summary"
            data-busy={String(busy)}
            onCancel={(event) => {
                if (busy) event.preventDefault(); else handleCancel();
            }}
        >
            <form id="export-form" onSubmit={(event) => {
                event.preventDefault();
                if (!busy) void handleConfirm();
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Archivo</p>
                        <h2 id="export-title">Exportar historia</h2>
                        <p id="export-copy" className="export-desc">Descargá una copia portable de tus registros.</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Cerrar" disabled={busy}
                            onClick={handleCancel}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                <p className="form-error export-error" id="export-error" role="alert"
                   hidden={!error && !expError}>{error || expError}</p>

                <button type="button" className="button secondary export-reconnect" hidden={!sessionLost}
                        onClick={onReconnect}>
                    Reconectar Google Drive
                </button>

                <div className="export-summary" id="export-summary">
                    <span className="export-summary-icon"><svg className="icon"><use href="#i-download"/></svg></span>
                    <div>
                        <strong>{getStudiesToExport().length} {getStudiesToExport().length === 1 ? 'estudio' : 'estudios'}</strong>
                        <span>{hasOtherRecords ? 'Incluye operaciones, portales, consultas, recetas, episodios y turnos.' : 'Se descargará un archivo ZIP con el manifiesto y los documentos seleccionados.'}</span>
                    </div>
                </div>

                <fieldset className="export-section" disabled={busy || sessionLost}>
                    <legend>Qué exportar</legend>
                    <div className="export-options">
                        <label className="export-option">
                            <input type="radio" name="export-scope" value="all" checked/>
                            <span>Todos los estudios <small>{visibleStudies.value.length}</small></span>
                        </label>
                    </div>
                </fieldset>

                <p className="export-note">La exportación incluye todos los estudios y sus entidades relacionadas.</p>

                <fieldset className="export-section" disabled={busy || sessionLost}>
                    <legend>Contenido a incluir</legend>
                    <div className="export-options">
                        <label className="export-option">
                            <input type="checkbox" checked={includePdfs}
                                   onChange={(e) => setIncludePdfs(e.currentTarget.checked)}/>
                            <svg className="icon">
                                <use href="#i-file"/>
                            </svg>
                            <span>Archivos PDF</span>
                        </label>
                        <label className="export-option">
                            <input type="checkbox" checked={includeViewerLinks}
                                   onChange={(e) => setIncludeViewerLinks(e.currentTarget.checked)}/>
                            <svg className="icon">
                                <use href="#i-external"/>
                            </svg>
                            <span>Enlaces a visores</span>
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
                    <button type="button" className="button quiet" disabled={busy} onClick={handleCancel}>Cancelar
                    </button>
                    <button type="submit" className="button primary" id="export-confirm"
                            disabled={busy || sessionLost || !hasRecords}>
                        {busy ? 'Exportando…' : 'Exportar'}
                    </button>
                </div>
            </form>
        </dialog>
    );
}

async function createExportZip(studiesToExport: Study[], includePdfs: boolean, includeViewerLinks: boolean): Promise<Blob> {
    const {default: JSZip} = await import('jszip');
    const zip = new JSZip();

    const manifest = {
        version: 1,
        scope: 'all',
        exportedAt: new Date().toISOString(),
        totalStudies: studiesToExport.length,
        studies: studiesToExport.map(s => ({
            id: s.id,
            title: s.title,
            date: s.date,
            types: s.types,
            doctor: s.doctor,
            portal: s.portal,
            viewer: includeViewerLinks ? s.viewer : '',
            reportName: s.reportName,
            hasPdf: s.hasPdf,
            operationId: s.operationId,
            documentIds: s.documentIds,
        }))
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const pdfsFolder = includePdfs ? zip.folder('pdfs') : null;
    const viewerLinks: string[] = [];

    for (const study of studiesToExport) {
        if (includePdfs && study.hasPdf && pdfsFolder) {
            let pdfFile: File;
            try {
                pdfFile = await driveStudyRepo.getPdfFile(study.driveFileId);
            } catch {
                throw new Error(`No se pudo incluir el PDF de «${study.title}». Revisá la conexión y volvé a intentar.`);
            }
            pdfsFolder.file(`${study.id}.pdf`, await pdfFile.arrayBuffer());
        }

        if (includeViewerLinks && study.viewer) {
            viewerLinks.push(`${study.title} (${study.date}): ${study.viewer}`);
        }
    }

    if (includeViewerLinks && viewerLinks.length > 0) {
        zip.file('viewer-links.txt', viewerLinks.join('\n\n'));
    }

    // Include all related data
    const operationsList = operations.value.map(op => ({
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

    const portalsList = portals.value.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        url: p.url,
        notes: p.notes,
    }));
    zip.file('portals.json', JSON.stringify(portalsList, null, 2));

    const eventsList = medicalEvents.value.map(e => ({
        id: e.id,
        kind: e.kind,
        date: e.date,
        doctor: e.doctor,
        notes: e.notes,
        studyIds: e.studyIds,
        documentIds: e.documentIds,
    }));
    zip.file('medical-events.json', JSON.stringify(eventsList, null, 2));

    zip.file('episodes.json', JSON.stringify(episodes.value, null, 2));
    zip.file('appointments.json', JSON.stringify(appointments.value, null, 2));

    return zip.generateAsync({type: 'blob', compression: 'DEFLATE', compressionOptions: {level: 6}});
}
