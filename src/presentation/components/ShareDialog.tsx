import {useEffect, useRef, useState} from 'preact/hooks';
import {
    sharingStudyId,
    shareSelection,
    studies,
    setSharingStudyId,
    setShareSelection,
    markSourceUnavailable
} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';
import {driveAuth, driveStudyRepo} from '@data';

interface ShareDialogProps {
    onReconnect: () => void;
    error: string | null;
    busy: boolean;
    sessionLost: boolean;
}

function getFileNameFromUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.pathname.split('/').pop() || 'archivo';
    } catch {
        return 'archivo';
    }
}

function sanitizeFilename(name: string): string {
    // Remove invalid filename characters
    let result = name.replace(/[<>:"\\|?*]/g, '_');
    result = result.replace(/\//g, '_');
    // Remove control characters (0x00-0x1F)
    result = result.split('').filter((ch) => ch.charCodeAt(0) > 0x1F).join('');
    return result.trim();
}

export function ShareDialog({onReconnect, error, busy, sessionLost}: ShareDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const id = sharingStudyId.value;
    const study = studies.value.find((s) => s.id === id);
    const selection = shareSelection.value;

    const [includePdf, setIncludePdf] = useState(false);
    const [includeViewer, setIncludeViewer] = useState(false);
    const [documentIds, setDocumentIds] = useState<string[]>([]);
    const [filename, setFilename] = useState('');
    const [filenameError, setFilenameError] = useState('');
    const [prepared, setPrepared] = useState<ShareData | null>(null);
    const [preparing, setPreparing] = useState(false);
    const generation = useRef(0);

    useFocusTrap(dialogRef, Boolean(id));

    useEffect(() => driveAuth.onAuthChange((signedIn: boolean) => {
        if (!signedIn) {
            generation.current += 1;
            setPrepared(null);
            setSharingStudyId(null);
            setShareSelection(null);
        }
    }), []);

    useEffect(() => {
        const element = dialogRef.current;
        if (!element) return;
        if (id && !element.open) {
            const s = study;
            if (s) {
                setDocumentIds([]);
                setFilenameError('');
                const pdfAvailable = s.hasPdf && !s.pendingAttachment;
                const viewerAvailable = Boolean(s.viewer);
                setIncludePdf(pdfAvailable);
                setIncludeViewer(viewerAvailable && !pdfAvailable);
                const baseName = (pdfAvailable ? s.reportName || s.title : getFileNameFromUrl(s.viewer || '')) || 'estudio';
                setFilename(sanitizeFilename(baseName));
                setShareSelection({
                    includePdf: pdfAvailable,
                    includeViewer: viewerAvailable && !pdfAvailable,
                    filename: sanitizeFilename(baseName),
                });
            }
            element.showModal();
            element.querySelector<HTMLButtonElement>('.quiet')?.focus();
        } else if (!id && element.open) element.close();
    }, [id]);

    useEffect(() => {
        if (selection) {
            setIncludePdf(selection.includePdf);
            setIncludeViewer(selection.includeViewer);
            setFilename(selection.filename);
        }
    }, [selection]);

    const associatedDocuments = (study?.documentIds ?? []).map(docId => studies.value.find(item => item.id === docId && item.hasPdf && !item.pendingAttachment)).filter(item => item !== undefined);
    const hasShareableContent = Boolean((study?.hasPdf && !study.pendingAttachment) || study?.viewer || associatedDocuments.length);

    const handleClose = () => {
        generation.current += 1;
        setPrepared(null);
        dialogRef.current?.close();
        setSharingStudyId(null);
        setShareSelection(null);
    };

    const handleCancel = () => {
        handleClose();
    };

    const handleConfirm = async () => {
        if (!id || !study) return;
        if (!includePdf && !includeViewer && !documentIds.length) {
            setFilenameError('Seleccioná al menos una fuente para compartir');
            return;
        }
        const safeFilename = sanitizeFilename(filename);
        if (!safeFilename) {
            setFilenameError('Ingresá un nombre para el archivo');
            return;
        }
        const selection = {includePdf, includeViewer, filename: safeFilename};

        const files: File[] = [];
        const urls: string[] = [];

        const selectedDocuments = associatedDocuments.filter(document => documentIds.includes(document.id));
        if (selectedDocuments.length !== documentIds.length) {
            setFilenameError('Un documento seleccionado ya no está disponible.');
            return;
        }
        if ((selection.includePdf && study.hasPdf && !study.pendingAttachment) || selectedDocuments.length) {
            const currentGeneration = ++generation.current;
            setPreparing(true);
            try {
                const token = await driveAuth.getAccessToken();
                if (selection.includePdf && study.hasPdf && !study.pendingAttachment) {
                    const file = await driveStudyRepo.getPdfFile(study.driveFileId);
                    const name = /\.pdf$/i.test(selection.filename) ? selection.filename : `${selection.filename}.pdf`;
                    files.push(new File([file], name, {type: 'application/pdf'}));
                }
                for (const document of selectedDocuments) {
                    const file = await driveStudyRepo.getPdfFile(document.driveFileId);
                    const base = sanitizeFilename(document.reportName || document.title) || 'documento';
                    const name = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
                    files.push(new File([file], `${document.id}-${name}`, {type: 'application/pdf'}));
                }
                if (currentGeneration !== generation.current || await driveAuth.getAccessToken() !== token) return;
            } catch {
                if (currentGeneration !== generation.current) return;
                markSourceUnavailable(study.id);
                setFilenameError('No se pudo descargar el PDF. Revisá la conexión y la sesión.');
                return;
            } finally {
                if (currentGeneration === generation.current) setPreparing(false);
            }
        }

        if (selection.includeViewer && study.viewer) {
            urls.push(study.viewer);
        }

        const shareData: ShareData & { files?: File[] } = {
            title: study.title,
            text: `Estudio médico: ${study.title} (${study.date})`,
        };
        if (files.length) shareData.files = files;
        if (urls.length) shareData.url = urls[0];
        if (files.length) {
            setPrepared(shareData);
            return;
        }
        await sendShare(shareData);
    };

    const sendShare = async (shareData: ShareData) => {
        try {
            if (!navigator.share || (navigator.canShare && !navigator.canShare(shareData))) {
                throw new Error('El navegador no soporta compartir nativo');
            }
            await navigator.share(shareData);
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                // User cancelled the share dialog
            } else if ((err as Error).message.includes('soporta compartir')) {
                setFilenameError('El navegador no permite compartir este contenido.');
            } else {
                setFilenameError('No se pudo completar el envío. Probá de nuevo o usá otro método.');
            }
            return;
        }

        setFilenameError('');
        handleClose();
    };

    const downloadPrepared = (file: File) => {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const pdfAvailable = study?.hasPdf && !study?.pendingAttachment;
    const viewerAvailable = Boolean(study?.viewer);

    return (
        <dialog id="share" ref={dialogRef} className="dialog" aria-labelledby="share-title"
                data-busy={String(busy || preparing)}
                onCancel={(event) => {
                    if (busy || preparing) event.preventDefault(); else handleCancel();
                }}>
            <form id="share-form" onSubmit={(event) => {
                event.preventDefault();
                if (id && !busy && !preparing) void handleConfirm();
            }}>
                <div className="dialog-heading">
                    <div><h2 id="share-title">Compartir estudio</h2>
                        <p id="share-copy">{study ? `«${study.title}»` : ''}</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Cerrar" disabled={busy}
                            onClick={handleCancel}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>
                <p className="form-error" id="share-error" role="alert"
                   hidden={!error && !filenameError}>{error || filenameError}</p>
                <button type="button" className="button secondary reconnect" hidden={!sessionLost}
                        onClick={onReconnect}>Reconectar Google Drive
                </button>
                <fieldset disabled={busy || sessionLost || preparing || Boolean(prepared)}>
                    <legend>Qué compartir</legend>
                    <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                        {pdfAvailable && (
                            <label style={{display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px'}}>
                                <input
                                    type="checkbox"
                                    checked={includePdf}
                                    onChange={(e) => {
                                        setIncludePdf(e.currentTarget.checked);
                                        setFilenameError('');
                                    }}
                                    disabled={!pdfAvailable}
                                />
                                <svg className="icon" style={{width: 20, height: 20, flex: 'none'}}>
                                    <use href="#i-file"/>
                                </svg>
                                <span>Informe PDF ({study?.reportName || study?.title})</span>
                            </label>
                        )}
                        {!pdfAvailable && study?.hasPdf && study?.pendingAttachment && (
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                minHeight: '44px',
                                opacity: 0.6
                            }}>
                                <input type="checkbox" disabled/>
                                <svg className="icon" style={{width: 20, height: 20, flex: 'none'}}>
                                    <use href="#i-file"/>
                                </svg>
                                <span>Informe PDF (pendiente de sincronización)</span>
                            </label>
                        )}
                        {viewerAvailable && (
                            <label style={{display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px'}}>
                                <input
                                    type="checkbox"
                                    checked={includeViewer}
                                    onChange={(e) => {
                                        setIncludeViewer(e.currentTarget.checked);
                                        setFilenameError('');
                                    }}
                                />
                                <svg className="icon" style={{width: 20, height: 20, flex: 'none'}}>
                                    <use href="#i-external"/>
                                </svg>
                                <span>Enlace al visor</span>
                            </label>
                        )}
                        {associatedDocuments.map(document => <label key={document.id}>
                            <input type="checkbox" value={document.id} checked={documentIds.includes(document.id)}
                                   onChange={(event) => {
                                       setDocumentIds(event.currentTarget.checked ? [...documentIds, document.id] : documentIds.filter(id => id !== document.id));
                                       setFilenameError('');
                                   }}/>
                            PDF asociado · {document.reportName || document.title}
                        </label>)}
                        {!hasShareableContent && (
                            <span style={{color: 'var(--muted)', fontSize: '0.9rem'}}>Este estudio no tiene archivos ni enlaces para compartir</span>
                        )}
                    </div>
                </fieldset>
                <label style={{display: 'block', marginTop: '16px'}}>
                    Nombre del archivo
                    <input
                        type="text"
                        value={filename}
                        onInput={(e) => {
                            setFilename(e.currentTarget.value);
                            setFilenameError('');
                        }}
                        placeholder="ej. ecografia-abdominal-2024-01-15"
                        maxLength={120}
                        disabled={busy || sessionLost || preparing || Boolean(prepared)}
                    />
                    <p className="hint">El nombre se usará para el PDF compartido. No cambia el archivo original.</p>
                </label>
                <div className="dialog-actions">
                    <button type="button" className="button quiet" disabled={busy || preparing}
                            onClick={handleCancel}>Cancelar
                    </button>
                    {!prepared && !includePdf && !documentIds.length && includeViewer && study?.viewer && <>
                        <a href={`https://wa.me/?text=${encodeURIComponent(study.viewer)}`} target="_blank"
                           rel="noopener noreferrer">Abrir WhatsApp con enlace</a>
                        <a href={`mailto:?body=${encodeURIComponent(study.viewer)}`}>Abrir correo con enlace</a>
                    </>}
                    {prepared ? <>
                        <p role="status">Listo para
                            compartir {prepared.files?.map(file => file.name).join(', ')}{prepared.url ? ` · ${prepared.url}` : ''}</p>
                        <button type="button" onClick={() => setPrepared(null)}>Volver</button>
                        {prepared.files?.map((file, index) => <button type="button" key={index}
                                                                      onClick={() => downloadPrepared(file)}>Descargar {file.name}</button>)}
                        {prepared.url && <>
                            <a href={`https://wa.me/?text=${encodeURIComponent(prepared.url)}`} target="_blank"
                               rel="noopener noreferrer">Abrir WhatsApp con enlace</a>
                            <a href={`mailto:?body=${encodeURIComponent(prepared.url)}`}>Abrir correo con enlace</a>
                        </>}
                        <button type="button" className="button primary" id="share-send"
                                onClick={() => void sendShare(prepared)}>Compartir
                        </button>
                    </> : <button type="submit" className="button primary" id="share-confirm"
                                  disabled={busy || preparing || sessionLost || !hasShareableContent}>
                        {preparing ? 'Preparando…' : includePdf || documentIds.length ? 'Preparar archivo' : 'Compartir'}
                    </button>}
                </div>
            </form>
        </dialog>
    );
}
