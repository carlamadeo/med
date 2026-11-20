import {createPortal} from 'preact/compat';
import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, driveClient, DriveConflictError} from '@data';
import {readVerifiedStudyAttachment} from '@data/verified-study-attachment';
import type {Study} from '@domain/models';
import {formatStudyDate, hasStudyAttachment, reportUrl, studyAttachmentName} from '@domain/library';
import {useFocusTrap} from '../utils/focusTrap';

interface StudyPrintDialogProps {
    study: Study;
    onClose: () => void;
}

type AttachmentPreview = {pages: string[]} | {error: string};

function StudyPrintRecord({study}: {study: Study}) {
    return <article className="study-print-record">
        <p className="study-print-kicker">Mis estudios · 1 estudio</p>
        <h2>{study.title}</h2>
        <dl>
            <div><dt>Fecha del estudio</dt><dd>{formatStudyDate(study.date)}</dd></div>
            <div><dt>Tipo</dt><dd>{study.types.join(', ') || 'Sin tipo'}</dd></div>
            {study.specialty && <div><dt>Especialidad</dt><dd>{study.specialty}</dd></div>}
            {study.doctor && <div><dt>Profesional</dt><dd>{study.doctor}</dd></div>}
            {study.portal && <div><dt>Institución</dt><dd>{study.portal}</dd></div>}
            <div><dt>Fuentes</dt><dd>{hasStudyAttachment(study) || study.pendingAttachment ? 'Informe adjunto' : 'Sin informe adjunto'}{study.documentIds?.length ? ` · ${study.documentIds.length} documento(s) asociado(s)` : ''}{study.viewer ? ' · enlace al visor' : ''}</dd></div>
        </dl>
        {study.syncStatus && <p>Estado: {study.syncStatus === 'conflict' ? 'Requiere revisión' : study.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}</p>}
        <p className="study-print-generated">Preparado el {new Intl.DateTimeFormat('es-AR').format(new Date())}.</p>
    </article>;
}

function StudyPrintPages({pages}: {pages: string[]}) {
    return <section className="study-print-pages" aria-label="Vista previa del archivo adjunto">
        {pages.map((url, index) => <img key={url} src={url} alt={`Página ${index + 1} del archivo adjunto`}/>)}
    </section>;
}

export function StudyPrintDialog({study, onClose}: StudyPrintDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const hasAttachment = hasStudyAttachment(study) || Boolean(study.pendingAttachment);
    const canReadAttachment = hasStudyAttachment(study) && Boolean(study.driveFileId) && !study.pendingAttachment;
    const [mode, setMode] = useState<'attachment' | 'record'>(hasAttachment ? 'attachment' : 'record');
    const [attachment, setAttachment] = useState<AttachmentPreview | null>(null);
    const [attempt, setAttempt] = useState(0);
    const pages = attachment && 'pages' in attachment ? attachment.pages : null;
    const error = attachment && 'error' in attachment ? attachment.error : null;
    useFocusTrap(dialog);

    useEffect(() => {
        const element = dialog.current;
        const trigger = document.activeElement;
        element?.showModal();
        return () => {
            element?.close();
            if (trigger instanceof HTMLElement) trigger.focus();
        };
    }, []);

    useEffect(() => driveAuth.onAuthChange(onClose), [onClose]);

    useEffect(() => {
        if (!canReadAttachment) return;
        const controller = new AbortController();
        const {signal} = controller;
        const urls: string[] = [];
        const releaseUrls = () => urls.splice(0).forEach(url => URL.revokeObjectURL(url));

        async function prepare() {
            if (!navigator.onLine) {
                setAttachment({error: 'Conectate a internet para preparar el archivo adjunto.'});
                return;
            }
            try {
                const token = await driveAuth.getAccessToken();
                signal.throwIfAborted();
                const file = await readVerifiedStudyAttachment(study, token);
                signal.throwIfAborted();
                const images = file.type === 'application/pdf'
                    ? await (await import('@data/pdf-print')).renderPdfForPrint(file, signal)
                    : [file];
                for (const image of images) {
                    signal.throwIfAborted();
                    const preview = new Image();
                    preview.src = URL.createObjectURL(image);
                    urls.push(preview.src);
                    await preview.decode();
                }
                await driveClient.assertSession(token);
                signal.throwIfAborted();
                if (!urls.length) throw new Error('El adjunto no contiene páginas.');
                setAttachment({pages: [...urls]});
            } catch (error) {
                releaseUrls();
                if (signal.aborted) return;
                setAttachment({error: error instanceof DriveConflictError
                    ? 'El archivo cambió en Drive. Actualizá la Biblioteca antes de imprimir.'
                    : 'No se pudo preparar el archivo adjunto para imprimir.'});
            }
        }

        void prepare();
        return () => {
            controller.abort();
            releaseUrls();
        };
    }, [study, canReadAttachment, attempt]);

    const renderPreview = () => mode === 'record'
        ? <StudyPrintRecord study={study}/>
        : pages && <StudyPrintPages pages={pages}/>;

    return <>
        <dialog ref={dialog} className="dialog study-print-dialog" aria-labelledby="study-print-title"
                onCancel={event => {
                    event.preventDefault();
                    onClose();
                }}>
            <div className="dialog-heading">
                <div>
                    <h2 id="study-print-title">Preparar impresión</h2>
                    <p>{study.title}</p>
                </div>
                <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
                    <svg className="icon"><use href="#i-close"/></svg>
                </button>
            </div>
            {hasAttachment && <fieldset className="study-print-options">
                <legend>Qué imprimir</legend>
                <label><input type="radio" name="study-print-mode" checked={mode === 'attachment'}
                              onChange={() => setMode('attachment')}/> Archivo adjunto</label>
                <label><input type="radio" name="study-print-mode" checked={mode === 'record'}
                              onChange={() => setMode('record')}/> Ficha del estudio</label>
            </fieldset>}
            {mode === 'attachment' && <div className="study-print-source">
                {canReadAttachment ? <>
                    <a href={reportUrl(study.driveFileId)} target="_blank" rel="noopener noreferrer">Abrir original en Drive</a>
                    <p className="study-print-note">{studyAttachmentName(study)}</p>
                    {error ? <>
                        <p className="form-error" role="alert">{error}</p>
                        <button type="button" className="button secondary" onClick={() => {
                            setAttachment(null);
                            setAttempt(attempt + 1);
                        }}>Reintentar</button>
                    </> : !pages && <p className="study-print-note" role="status">Preparando el archivo adjunto…</p>}
                </> : <p className="study-print-note" role="status">El adjunto todavía no está disponible para imprimir.</p>}
            </div>}
            {renderPreview()}
            <div className="dialog-actions">
                <button type="button" className="button quiet" onClick={onClose}>Cancelar</button>
                <button type="button" className="button primary" disabled={mode === 'attachment' && !pages}
                        onClick={() => window.print()}>Imprimir</button>
            </div>
        </dialog>
        {createPortal(<div className="study-print-output">{renderPreview()}</div>, document.body)}
    </>;
}
