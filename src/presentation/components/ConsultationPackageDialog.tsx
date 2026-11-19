import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, DriveConflictError, DriveSessionError} from '@data';
import {readVerifiedStudyAttachment, StudyAttachmentFormatError} from '@data/verified-study-attachment';
import {studyAttachmentLabel} from '@domain/library';
import type {Study} from '@domain/models';
import {useFocusTrap} from '../utils/focusTrap';

export type ConsultationSource = {
    key: string;
    title: string;
    href: string;
} & ({kind: 'attachment'; study: Study} | {kind: 'viewer'});

interface Props {
    sources: ConsultationSource[];
    onClose: () => void;
}

function fileExtension(file: File): string {
    return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'pdf';
}

export function ConsultationPackageDialog({sources, onClose}: Props) {
    const [preview] = useState(sources);
    const [selected, setSelected] = useState(() =>
        new Set(preview.filter(source => source.kind === 'attachment').map(source => source.key)));
    const [preparing, setPreparing] = useState(false);
    const [error, setError] = useState('');
    const owner = useRef(driveAuth.cachedAccountId());
    const dialog = useRef<HTMLDialogElement>(null);
    const cancelled = useRef(false);
    const busy = useRef(false);
    const latestSources = useRef(sources);
    latestSources.current = sources;
    useFocusTrap(dialog);

    function close() {
        cancelled.current = true;
        dialog.current?.close();
        onClose();
    }

    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        element?.querySelector<HTMLElement>('h2')?.focus();
        const unsubscribe = driveAuth.onAuthChange(signedIn => {
            if (!signedIn) close();
        });
        return () => {
            cancelled.current = true;
            unsubscribe();
            element?.close();
        };
    }, []);

    async function download() {
        if (busy.current || selected.size === 0) return;
        busy.current = true;
        setPreparing(true);
        setError('');
        const included = preview.filter(source => selected.has(source.key));
        const assertSelection = () => {
            if (owner.current === null || driveAuth.cachedAccountId() !== owner.current) throw new DriveSessionError();
            const latest = new Map(latestSources.current.map(source => [source.key, source]));
            if (included.some(source => {
                const current = latest.get(source.key);
                return !current || current.href !== source.href ||
                    (source.kind === 'attachment' && (current.kind !== 'attachment' ||
                        current.study.revision !== source.study.revision));
            })) throw new DriveConflictError();
        };

        try {
            const token = await driveAuth.getAccessToken();
            if (cancelled.current) return;
            assertSelection();
            const {default: JSZip} = await import('jszip');
            const archive = new JSZip();
            const links: string[] = [];
            let fileNumber = 0;
            for (const source of included) {
                if (cancelled.current) return;
                if (source.kind === 'viewer') {
                    links.push(source.href);
                } else {
                    const file = await readVerifiedStudyAttachment(source.study, token);
                    archive.file(`archivo-${++fileNumber}.${fileExtension(file)}`, await file.arrayBuffer());
                }
            }
            if (links.length) archive.file('enlaces.txt', `${links.join('\n')}\n`);
            if (cancelled.current) return;
            const zip = await archive.generateAsync({type: 'blob'});
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            if (cancelled.current) return;
            assertSelection();
            const url = URL.createObjectURL(zip);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'consulta.zip';
            document.body.append(link);
            try {
                link.click();
            } finally {
                link.remove();
                window.setTimeout(URL.revokeObjectURL.bind(URL, url), 1000);
            }
        } catch (err) {
            if (cancelled.current) return;
            if (err instanceof DriveConflictError) {
                setError('Una fuente seleccionada cambió. Cerrá esta vista y revisá los estudios del turno.');
            } else if (err instanceof DriveSessionError || err instanceof StudyAttachmentFormatError) {
                setError(err.message);
            } else {
                setError('No se pudo preparar la descarga. Revisá la conexión y volvé a intentar.');
            }
        } finally {
            busy.current = false;
            if (!cancelled.current) setPreparing(false);
        }
    }

    return (
        <dialog ref={dialog} className="dialog" aria-label="Preparar consulta"
                onCancel={event => { event.preventDefault(); close(); }}>
            <form onSubmit={event => { event.preventDefault(); void download(); }}>
                <div className="dialog-heading">
                    <div>
                        <h2 tabIndex={-1}>Preparar consulta</h2>
                        <p>Elegí los archivos y enlaces que querés guardar juntos en este dispositivo.</p>
                    </div>
                </div>
                <fieldset className="appointment-study-picker" disabled={preparing}>
                    <legend>Fuentes de los estudios del turno</legend>
                    <div className="appointment-study-options">
                        {preview.map(source => (
                            <label key={source.key}>
                                <input type="checkbox" data-source={source.kind} checked={selected.has(source.key)}
                                       onChange={event => {
                                           const checked = event.currentTarget.checked;
                                           setSelected(previous => {
                                               const next = new Set(previous);
                                               if (checked) next.add(source.key);
                                               else next.delete(source.key);
                                               return next;
                                           });
                                       }}/>
                                <span>
                                    {source.title} · {source.kind === 'attachment' ? studyAttachmentLabel(source.study) : 'Enlace al visor'}
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <p className="appointment-note" role="status">
                    {preparing ? 'Verificando los archivos y preparando el ZIP…'
                        : `${selected.size} ${selected.size === 1 ? 'fuente seleccionada' : 'fuentes seleccionadas'}`}
                </p>
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="dialog-actions">
                    <button type="button" className="button secondary" onClick={close}>Cerrar</button>
                    <button type="submit" className="button primary" disabled={preparing || !selected.size}>
                        Descargar ZIP
                    </button>
                </div>
            </form>
        </dialog>
    );
}
