import {useEffect, useRef, useState} from 'preact/hooks';
import {formatStudyDate, hasStudyAttachment, studyAttachmentName} from '@domain/library';
import type {Study} from '@domain/models';
import {
    sharingStudyId,
    sharingStudyIds,
    shareSelection,
    studies,
    setSharingStudyId,
    setSharingStudyIds,
    setShareSelection,
    markSourceUnavailable,
    isSourceUnavailable,
} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';
import {driveAuth, DriveConflictError, DriveError, DriveSessionError} from '@data';
import {readVerifiedStudyAttachment, StudyAttachmentFormatError} from '@data/verified-study-attachment';

interface ShareDialogProps {
    onReconnect: () => void;
    onPrint?: (study: Study) => void;
    error: string | null;
    busy: boolean;
    sessionLost: boolean;
}

interface PreviewItem {
    study: Study;
    associated: Study[];
}

interface ViewerLink {
    title: string;
    url: string;
}

function sanitizeFilename(name: string): string {
    // Remove invalid filename characters
    let result = name.replace(/[<>:"\\|?*]/g, '_');
    result = result.replace(/\//g, '_');
    // Remove control characters (0x00-0x1F)
    result = result.split('').filter((ch) => ch.charCodeAt(0) > 0x1F).join('');
    return result.trim();
}

function deduplicateFilename(name: string, usedLowerNames: Set<string>): string {
    if (!usedLowerNames.has(name.toLowerCase())) {
        usedLowerNames.add(name.toLowerCase());
        return name;
    }
    const match = /^(.*?)(\.(?:pdf|jpe?g|png))$/i.exec(name);
    const base = match ? match[1]! : name;
    const ext = match ? match[2]! : '';
    let suffix = 2;
    let candidate = `${base}-${suffix}${ext}`;
    while (usedLowerNames.has(candidate.toLowerCase())) {
        suffix += 1;
        candidate = `${base}-${suffix}${ext}`;
    }
    usedLowerNames.add(candidate.toLowerCase());
    return candidate;
}

async function downloadStudyAttachment(study: Study, basename: string, token: string): Promise<File> {
    const file = await readVerifiedStudyAttachment(study, token);
    const extension = file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/png' ? '.png' : '.pdf';
    const normalized = basename.toLowerCase();
    const hasExtension = normalized.endsWith(extension) || (extension === '.jpg' && normalized.endsWith('.jpeg'));
    return new File([file], hasExtension ? basename : `${basename}${extension}`, {type: file.type});
}

function formatViewerLinksText(links: readonly ViewerLink[]): string {
    if (links.length === 0) return '';
    if (links.length === 1) return links[0]!.url;
    return links.map((link) => `${link.title}: ${link.url}`).join('\n');
}

export function ShareDialog({onReconnect, onPrint, error, busy, sessionLost}: ShareDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const activeIds = sharingStudyIds.value.length > 0
        ? sharingStudyIds.value
        : (sharingStudyId.value ? [sharingStudyId.value] : []);
    const activeKey = activeIds.join(',');
    const isMulti = activeIds.length > 1;
    const isOpen = activeIds.length > 0;
    const selection = shareSelection.value;

    const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
    const [includeAttachment, setIncludeAttachment] = useState(false);
    const [includeViewer, setIncludeViewer] = useState(false);
    const [documentIds, setDocumentIds] = useState<string[]>([]);
    const [multiAttachments, setMultiAttachments] = useState<string[]>([]);
    const [multiViewers, setMultiViewers] = useState<string[]>([]);
    const [multiDocs, setMultiDocs] = useState<string[]>([]);
    const [filename, setFilename] = useState('');
    const [filenameError, setFilenameError] = useState('');
    const [prepared, setPrepared] = useState<ShareData | null>(null);
    const [preparedViewerLinks, setPreparedViewerLinks] = useState<ViewerLink[]>([]);
    const [preparing, setPreparing] = useState(false);
    const [zipping, setZipping] = useState(false);
    const generation = useRef(0);

    const singlePreview = previewItems[0];
    const study = !isMulti ? singlePreview?.study : undefined;
    const associatedDocuments = !isMulti ? (singlePreview?.associated ?? []) : [];

    useFocusTrap(dialogRef, isOpen);

    useEffect(() => driveAuth.onAuthChange((signedIn: boolean) => {
        if (!signedIn) {
            generation.current += 1;
            setPrepared(null);
            setPreparedViewerLinks([]);
            setPreparing(false);
            setZipping(false);
            setSharingStudyId(null);
            setSharingStudyIds([]);
            setShareSelection(null);
        }
    }), []);

    useEffect(() => {
        const element = dialogRef.current;
        if (!element) return;
        generation.current += 1;
        setPrepared(null);
        setPreparedViewerLinks([]);
        setPreparing(false);
        setZipping(false);
        if (activeIds.length > 0) {
            const archive = studies.peek();
            const items = activeIds
                .map((studyId) => {
                    const s = archive.find((item) => item.id === studyId);
                    if (!s) return null;
                    const associated = (s.documentIds ?? [])
                        .map((docId) => archive.find((item) => item.id === docId && hasStudyAttachment(item) && !item.pendingAttachment))
                        .filter((item): item is Study => item !== undefined);
                    return {study: s, associated};
                })
                .filter((item): item is PreviewItem => item !== null);
            setPreviewItems(items);
            setFilenameError('');

            if (activeIds.length === 1) {
                setMultiAttachments([]);
                setMultiViewers([]);
                setMultiDocs([]);
                const s = items[0]?.study;
                if (s) {
                    setDocumentIds([]);
                    const attachmentAvailable = hasStudyAttachment(s) && !s.pendingAttachment;
                    const viewerAvailable = Boolean(s.viewer);
                    setIncludeAttachment(attachmentAvailable);
                    setIncludeViewer(viewerAvailable && !attachmentAvailable);
                    const baseName = sanitizeFilename(s.reportName || s.title) || 'estudio';
                    setFilename(baseName);
                    setShareSelection({
                        includeAttachment: attachmentAvailable,
                        includeViewer: viewerAvailable && !attachmentAvailable,
                        filename: baseName,
                    });
                }
            } else {
                setIncludeAttachment(false);
                setIncludeViewer(false);
                setDocumentIds([]);
                setFilename('');
                const defaultAttachments: string[] = [];
                const defaultViewers: string[] = [];
                const defaultDocs: string[] = [];
                for (const item of items) {
                    const attachmentAvailable = hasStudyAttachment(item.study) && !item.study.pendingAttachment;
                    const viewerAvailable = Boolean(item.study.viewer);
                    if (attachmentAvailable) {
                        defaultAttachments.push(item.study.id);
                    } else if (viewerAvailable) {
                        defaultViewers.push(item.study.id);
                    } else if (item.associated.length > 0) {
                        for (const doc of item.associated) {
                            defaultDocs.push(`${item.study.id}:${doc.id}`);
                        }
                    }
                }
                setMultiAttachments(defaultAttachments);
                setMultiViewers(defaultViewers);
                setMultiDocs(defaultDocs);
            }

            if (!element.open) element.showModal();
            element.querySelector<HTMLElement>('#share-title')?.focus();
        } else {
            setPreviewItems([]);
            if (element.open) element.close();
        }
    }, [activeKey]);

    useEffect(() => {
        if (selection && !isMulti) {
            setIncludeAttachment(selection.includeAttachment);
            setIncludeViewer(selection.includeViewer);
            setFilename(selection.filename);
        }
    }, [selection, isMulti]);

    const attachmentAvailable = Boolean(study && hasStudyAttachment(study) && !study.pendingAttachment);
    const hasShareableContent = isMulti
        ? previewItems.some((item) => (hasStudyAttachment(item.study) && !item.study.pendingAttachment) || Boolean(item.study.viewer) || item.associated.length > 0)
        : Boolean(attachmentAvailable || study?.viewer || associatedDocuments.length);

    const handleClose = () => {
        generation.current += 1;
        setPrepared(null);
        setPreparedViewerLinks([]);
        setPreparing(false);
        setZipping(false);
        dialogRef.current?.close();
        setSharingStudyId(null);
        setSharingStudyIds([]);
        setShareSelection(null);
    };

    const handleCancel = () => {
        handleClose();
    };

    const handleConfirm = async () => {
        if (!isOpen) return;
        if (isMulti) {
            await handleConfirmMultiple();
            return;
        }
        const id = activeIds[0];
        if (!id || !study) return;
        if (!includeAttachment && !includeViewer && !documentIds.length) {
            setFilenameError('Seleccioná al menos una fuente para compartir');
            return;
        }
        const safeFilename = sanitizeFilename(filename);
        if (includeAttachment && !safeFilename) {
            setFilenameError('Ingresá un nombre para el archivo');
            return;
        }
        const currentSelection = {includeAttachment, includeViewer, filename: safeFilename};

        const files: File[] = [];
        const selectedDocuments = associatedDocuments.filter((document) => documentIds.includes(document.id));
        if (selectedDocuments.length !== documentIds.length) {
            setFilenameError('Un documento seleccionado ya no está disponible.');
            return;
        }
        if ((currentSelection.includeAttachment && attachmentAvailable) || selectedDocuments.length) {
            const currentGeneration = ++generation.current;
            setPreparing(true);
            let currentFileId: string | undefined;
            try {
                const token = await driveAuth.getAccessToken();
                if (currentGeneration !== generation.current) return;
                if (currentSelection.includeAttachment && attachmentAvailable) {
                    currentFileId = study.driveFileId;
                    files.push(await downloadStudyAttachment(study, currentSelection.filename, token));
                }
                for (const document of selectedDocuments) {
                    if (currentGeneration !== generation.current) return;
                    currentFileId = document.driveFileId;
                    const base = sanitizeFilename(document.reportName || document.title) || 'documento';
                    files.push(await downloadStudyAttachment(document, `${document.id}-${base}`, token));
                }
                if (await driveAuth.getAccessToken() !== token || currentGeneration !== generation.current) return;
            } catch (err) {
                if (currentGeneration !== generation.current) return;
                if (err instanceof DriveConflictError) {
                    setFilenameError('Un archivo seleccionado cambió en Drive. Cerrá el diálogo y actualizá la lista.');
                } else if (err instanceof StudyAttachmentFormatError || err instanceof DriveSessionError) {
                    setFilenameError(err.message);
                } else {
                    if (currentFileId && err instanceof DriveError && err.status === 404) {
                        markSourceUnavailable(currentFileId);
                    }
                    setFilenameError('No se pudo descargar el archivo. Revisá la conexión y la sesión.');
                }
                return;
            } finally {
                if (currentGeneration === generation.current) setPreparing(false);
            }
        }

        const shareData: ShareData = {};
        const viewerLinks: ViewerLink[] = [];
        if (files.length) shareData.files = files;
        if (currentSelection.includeViewer && study.viewer) {
            shareData.url = study.viewer;
            viewerLinks.push({title: study.title, url: study.viewer});
        }
        if (files.length) {
            setPreparedViewerLinks(viewerLinks);
            setPrepared(shareData);
            return;
        }
        await sendShare(shareData);
    };

    const handleConfirmMultiple = async () => {
        if (!previewItems.length) return;
        if (!multiAttachments.length && !multiViewers.length && !multiDocs.length) {
            setFilenameError('Seleccioná al menos una fuente para compartir');
            return;
        }

        const downloadQueue: Array<{ study: Study; baseName: string }> = [];
        const queuedTargetIds = new Set<string>();
        for (const item of previewItems) {
            const canAttach = hasStudyAttachment(item.study) && !item.study.pendingAttachment;
            if (canAttach && multiAttachments.includes(item.study.id) && !queuedTargetIds.has(item.study.id)) {
                queuedTargetIds.add(item.study.id);
                downloadQueue.push({
                    study: item.study,
                    baseName: sanitizeFilename(item.study.reportName || item.study.title) || 'estudio',
                });
            }
            for (const doc of item.associated) {
                const docKey = `${item.study.id}:${doc.id}`;
                if (multiDocs.includes(docKey) && !queuedTargetIds.has(doc.id)) {
                    queuedTargetIds.add(doc.id);
                    downloadQueue.push({
                        study: doc,
                        baseName: sanitizeFilename(doc.reportName || doc.title) || 'documento',
                    });
                }
            }
        }

        const selectedViewerLinks: ViewerLink[] = previewItems
            .filter((item) => multiViewers.includes(item.study.id) && Boolean(item.study.viewer))
            .map((item) => ({title: item.study.title, url: item.study.viewer}));

        const files: File[] = [];
        if (downloadQueue.length > 0) {
            const currentGeneration = ++generation.current;
            setPreparing(true);
            let currentTarget: Study | null = null;
            try {
                const token = await driveAuth.getAccessToken();
                if (currentGeneration !== generation.current) return;
                const usedLowerNames = new Set<string>();
                for (const target of downloadQueue) {
                    if (currentGeneration !== generation.current) return;
                    currentTarget = target.study;
                    const downloaded = await downloadStudyAttachment(target.study, target.baseName, token);
                    const uniqueName = deduplicateFilename(downloaded.name, usedLowerNames);
                    const finalFile = uniqueName === downloaded.name
                        ? downloaded
                        : new File([downloaded], uniqueName, {type: downloaded.type});
                    files.push(finalFile);
                }
                if (await driveAuth.getAccessToken() !== token || currentGeneration !== generation.current) return;
            } catch (err) {
                if (currentGeneration !== generation.current) return;
                if (err instanceof DriveConflictError) {
                    setFilenameError('Un archivo seleccionado cambió en Drive. Cerrá el diálogo y actualizá la lista.');
                } else if (err instanceof StudyAttachmentFormatError || err instanceof DriveSessionError) {
                    setFilenameError(err.message);
                } else {
                    if (currentTarget?.driveFileId && err instanceof DriveError && err.status === 404) {
                        markSourceUnavailable(currentTarget.driveFileId);
                    }
                    setFilenameError('No se pudo descargar el archivo. Revisá la conexión y la sesión.');
                }
                return;
            } finally {
                if (currentGeneration === generation.current) setPreparing(false);
            }
        }

        const shareData: ShareData = {};
        if (files.length) shareData.files = files;
        if (selectedViewerLinks.length === 1) {
            shareData.url = selectedViewerLinks[0]!.url;
        } else if (selectedViewerLinks.length > 1) {
            shareData.text = formatViewerLinksText(selectedViewerLinks);
        }

        if (files.length) {
            setPreparedViewerLinks(selectedViewerLinks);
            setPrepared(shareData);
            return;
        }
        await sendShare(shareData);
    };

    const sendShare = async (shareData: ShareData) => {
        const currentGeneration = generation.current;
        try {
            if (!navigator.share || (navigator.canShare && !navigator.canShare(shareData))) {
                throw new Error('El navegador no soporta compartir nativo');
            }
            await navigator.share(shareData);
        } catch (err) {
            if (currentGeneration !== generation.current) return;
            if ((err as Error).name === 'AbortError') {
                // User cancelled the share dialog
            } else if ((err as Error).message.includes('soporta compartir')) {
                setFilenameError('El navegador no permite compartir este contenido.');
            } else {
                setFilenameError('No se pudo completar el envío. Probá de nuevo o usá otro método.');
            }
            return;
        }

        if (currentGeneration !== generation.current) return;
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

    const downloadPreparedZip = async (files: File[], viewerLinks: ViewerLink[]) => {
        if (!files.length || zipping) return;
        const currentGeneration = generation.current;
        setZipping(true);
        setFilenameError('');
        try {
            const {default: JSZip} = await import('jszip');
            if (currentGeneration !== generation.current) return;
            const zip = new JSZip();
            for (const file of files) {
                zip.file(file.name, await file.arrayBuffer());
            }
            if (viewerLinks.length > 0) {
                const lines = viewerLinks.map((link) => `${link.title}: ${link.url}`);
                zip.file('enlaces.txt', `${lines.join('\n')}\n`);
            }
            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: {level: 6},
            });
            if (currentGeneration !== generation.current) return;
            downloadPrepared(new File([blob], 'estudios-compartidos.zip', {type: 'application/zip'}));
        } catch {
            if (currentGeneration === generation.current) {
                setFilenameError('No se pudo crear el archivo ZIP.');
            }
        } finally {
            if (currentGeneration === generation.current) {
                setZipping(false);
            }
        }
    };

    const viewerAvailable = Boolean(study?.viewer);
    const currentMultiViewerLinks: ViewerLink[] = isMulti
        ? previewItems
            .filter((item) => multiViewers.includes(item.study.id) && Boolean(item.study.viewer))
            .map((item) => ({title: item.study.title, url: item.study.viewer}))
        : [];
    const directViewerText = isMulti
        ? (!prepared && !multiAttachments.length && !multiDocs.length ? formatViewerLinksText(currentMultiViewerLinks) : '')
        : (!prepared && !includeAttachment && !documentIds.length && includeViewer && study?.viewer ? study.viewer : '');
    const preparedViewerText = prepared ? formatViewerLinksText(preparedViewerLinks) : '';
    const multiFileCount = multiAttachments.length + multiDocs.length;
    const confirmLabel = preparing
        ? 'Preparando…'
        : isMulti
            ? (multiFileCount > 1 ? 'Preparar archivos' : multiFileCount === 1 ? 'Preparar archivo' : 'Compartir')
            : (includeAttachment || documentIds.length ? 'Preparar archivo' : 'Compartir');

    return (
        <dialog id="share" ref={dialogRef} className="dialog" aria-labelledby="share-title"
                data-busy={String(busy || preparing || zipping)}
                onCancel={(event) => {
                    if (busy) event.preventDefault(); else handleCancel();
                }}>
            <form id="share-form" onSubmit={(event) => {
                event.preventDefault();
                if (isOpen && !busy && !preparing && !zipping) void handleConfirm();
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Biblioteca</p>
                        <h2 id="share-title" tabIndex={-1}>{isMulti ? 'Compartir estudios' : 'Compartir estudio'}</h2>
                        <p id="share-copy">
                            {isMulti
                                ? `${previewItems.length} estudios seleccionados`
                                : (study ? `«${study.title}»` : '')}
                        </p>
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
                <fieldset disabled={busy || sessionLost || preparing || zipping || Boolean(prepared)}>
                    <legend>Qué compartir</legend>
                    {isMulti ? (
                        <div className="share-options">
                            {previewItems.map(({study: item, associated}) => {
                                const itemAttachmentAvailable = hasStudyAttachment(item) && !item.pendingAttachment;
                                const itemViewerAvailable = Boolean(item.viewer);
                                const itemHasContent = itemAttachmentAvailable || itemViewerAvailable || associated.length > 0;
                                return (
                                    <div key={item.id} className="share-study-group">
                                        <div className="share-study-heading">
                                            <strong>{item.title}</strong>
                                            <span className="share-study-date">{formatStudyDate(item.date)}</span>
                                        </div>
                                        {itemAttachmentAvailable && (
                                            <label className="share-option-row">
                                                <input
                                                    type="checkbox"
                                                    data-share-study={item.id}
                                                    data-share-kind="attachment"
                                                    checked={multiAttachments.includes(item.id)}
                                                    onChange={(e) => {
                                                        const checked = e.currentTarget.checked;
                                                        setMultiAttachments((prev) => checked
                                                            ? (prev.includes(item.id) ? prev : [...prev, item.id])
                                                            : prev.filter((value) => value !== item.id));
                                                        setFilenameError('');
                                                    }}
                                                />
                                                <svg className="icon" aria-hidden="true">
                                                    <use href="#i-file"/>
                                                </svg>
                                                <span>{item.attachmentMime ? 'Imagen del informe' : 'Informe PDF'} ({studyAttachmentName(item)})</span>
                                            </label>
                                        )}
                                        {!itemAttachmentAvailable && item.pendingAttachment && (
                                            <label className="share-option-row share-option-disabled">
                                                <input type="checkbox" disabled/>
                                                <svg className="icon" aria-hidden="true">
                                                    <use href="#i-file"/>
                                                </svg>
                                                <span>Informe pendiente de sincronización</span>
                                            </label>
                                        )}
                                        {itemViewerAvailable && (
                                            <label className="share-option-row">
                                                <input
                                                    type="checkbox"
                                                    data-share-study={item.id}
                                                    data-share-kind="viewer"
                                                    checked={multiViewers.includes(item.id)}
                                                    onChange={(e) => {
                                                        const checked = e.currentTarget.checked;
                                                        setMultiViewers((prev) => checked
                                                            ? (prev.includes(item.id) ? prev : [...prev, item.id])
                                                            : prev.filter((value) => value !== item.id));
                                                        setFilenameError('');
                                                    }}
                                                />
                                                <svg className="icon" aria-hidden="true">
                                                    <use href="#i-external"/>
                                                </svg>
                                                <span>Enlace al visor</span>
                                            </label>
                                        )}
                                        {associated.map((document) => {
                                            const docKey = `${item.id}:${document.id}`;
                                            return (
                                                <label key={docKey} className="share-option-row">
                                                    <input
                                                        type="checkbox"
                                                        data-share-study={item.id}
                                                        data-share-kind="document"
                                                        value={docKey}
                                                        checked={multiDocs.includes(docKey)}
                                                        onChange={(e) => {
                                                            const checked = e.currentTarget.checked;
                                                            setMultiDocs((prev) => checked
                                                                ? (prev.includes(docKey) ? prev : [...prev, docKey])
                                                                : prev.filter((value) => value !== docKey));
                                                            setFilenameError('');
                                                        }}
                                                    />
                                                    <span>{document.attachmentMime ? 'Imagen asociada' : 'PDF asociado'} · {studyAttachmentName(document)}</span>
                                                </label>
                                            );
                                        })}
                                        {!itemHasContent && (
                                            <span className="share-doc-hint">Este estudio no tiene archivos ni enlaces para compartir</span>
                                        )}
                                    </div>
                                );
                            })}
                            {!hasShareableContent && (
                                <span className="share-doc-hint">Los estudios seleccionados no tienen archivos ni enlaces para compartir</span>
                            )}
                        </div>
                    ) : (
                        <div className="share-options">
                            {study && attachmentAvailable && (
                                <label className="share-option-row">
                                    <input
                                        type="checkbox"
                                        checked={includeAttachment}
                                        onChange={(e) => {
                                            setIncludeAttachment(e.currentTarget.checked);
                                            setFilenameError('');
                                        }}
                                        disabled={!attachmentAvailable}
                                    />
                                    <svg className="icon" aria-hidden="true">
                                        <use href="#i-file"/>
                                    </svg>
                                    <span>{study.attachmentMime ? 'Imagen del informe' : 'Informe PDF'} ({studyAttachmentName(study)})</span>
                                </label>
                            )}
                            {!attachmentAvailable && study?.pendingAttachment && (
                                <label className="share-option-row share-option-disabled">
                                    <input type="checkbox" disabled/>
                                    <svg className="icon" aria-hidden="true">
                                        <use href="#i-file"/>
                                    </svg>
                                    <span>Informe pendiente de sincronización</span>
                                </label>
                            )}
                            {viewerAvailable && (
                                <label className="share-option-row">
                                    <input
                                        type="checkbox"
                                        checked={includeViewer}
                                        onChange={(e) => {
                                            setIncludeViewer(e.currentTarget.checked);
                                            setFilenameError('');
                                        }}
                                    />
                                    <svg className="icon" aria-hidden="true">
                                        <use href="#i-external"/>
                                    </svg>
                                    <span>Enlace al visor</span>
                                </label>
                            )}
                            {associatedDocuments.map(document => <label key={document.id} className="share-option-row">
                                <input type="checkbox" value={document.id} checked={documentIds.includes(document.id)}
                                       onChange={(event) => {
                                           setDocumentIds(event.currentTarget.checked ? [...documentIds, document.id] : documentIds.filter(docId => docId !== document.id));
                                           setFilenameError('');
                                       }}/>
                                <span>{document.attachmentMime ? 'Imagen asociada' : 'PDF asociado'} · {studyAttachmentName(document)}</span>
                            </label>)}
                            {!hasShareableContent && (
                                <span className="share-doc-hint">Este estudio no tiene archivos ni enlaces para compartir</span>
                            )}
                        </div>
                    )}
                </fieldset>
                {!isMulti && includeAttachment && <label className="share-filename-field">
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
                        disabled={busy || sessionLost || preparing || zipping || Boolean(prepared)}
                    />
                    <p className="hint">El nombre se usará para la copia que compartís.</p>
                </label>}
                <div className="dialog-actions">
                    <button type="button" className="button secondary" disabled={busy}
                            onClick={handleCancel}>Cancelar
                    </button>
                    {onPrint && study && attachmentAvailable && study.driveFileId && !isSourceUnavailable(study.driveFileId) && !prepared && (
                        <button type="button" className="button secondary"
                                disabled={busy || sessionLost || preparing || zipping}
                                onClick={() => {
                                    handleClose();
                                    onPrint(study);
                                }}>
                            <svg className="icon" aria-hidden="true">
                                <use href="#i-print"/>
                            </svg>
                            Imprimir archivo</button>
                    )}
                    {directViewerText && (
                        <div className="share-links">
                            <a className="button secondary button-sm"
                               href={`https://wa.me/?text=${encodeURIComponent(directViewerText)}`} target="_blank"
                               rel="noopener noreferrer">Abrir WhatsApp con enlace</a>
                            <a className="button secondary button-sm"
                               href={`mailto:?body=${encodeURIComponent(directViewerText)}`}>Abrir correo con enlace</a>
                        </div>
                    )}
                    {prepared ? <>
                        <p role="status" className="share-prepared-note">
                            Listo para compartir {prepared.files?.map(file => file.name).join(', ')}
                            {preparedViewerLinks.length > 0 ? ` · ${preparedViewerLinks.map(link => link.url).join(', ')}` : ''}
                        </p>
                        <button type="button" className="button secondary" onClick={() => {
                            setPrepared(null);
                            setPreparedViewerLinks([]);
                        }}>Volver
                        </button>
                        {prepared.files && prepared.files.length > 1 && (
                            <button
                                type="button"
                                className="button secondary"
                                id="share-download-zip"
                                disabled={zipping}
                                onClick={() => void downloadPreparedZip(prepared.files!, preparedViewerLinks)}
                            >
                                {zipping ? 'Creando ZIP…' : 'Descargar todo en ZIP'}
                            </button>
                        )}
                        {prepared.files?.map((file, index) => (
                            <button type="button" className="button secondary" key={index}
                                    onClick={() => downloadPrepared(file)}>Descargar {file.name}</button>
                        ))}
                        {preparedViewerText && (
                            <div className="share-links">
                                <a className="button secondary button-sm"
                                   href={`https://wa.me/?text=${encodeURIComponent(preparedViewerText)}`}
                                   target="_blank"
                                   rel="noopener noreferrer">Abrir WhatsApp con enlace</a>
                                <a className="button secondary button-sm"
                                   href={`mailto:?body=${encodeURIComponent(preparedViewerText)}`}>Abrir correo con
                                    enlace</a>
                            </div>
                        )}
                        <button type="button" className="button primary" id="share-send"
                                onClick={() => void sendShare(prepared)}>Compartir
                        </button>
                    </> : <button type="submit" className="button primary" id="share-confirm"
                                  disabled={busy || preparing || sessionLost || !hasShareableContent}>
                        {confirmLabel}
                    </button>}
                </div>
            </form>
        </dialog>
    );
}
