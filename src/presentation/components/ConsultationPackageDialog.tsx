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

interface PreparedConsultation {
    token: string;
    files: File[];
    links: string[];
}

type Action = 'zip' | 'prepare' | 'share' | 'file';

const actionErrors: Record<Action, string> = {
    zip: 'No se pudo preparar la descarga. Revisá la conexión y volvé a intentar.',
    prepare: 'No se pudieron preparar los archivos. Revisá la conexión y volvé a intentar.',
    share: 'No se pudo abrir el menú para compartir. Podés intentar de nuevo o descargar los archivos.',
    file: 'No se pudo descargar el archivo. Volvé a intentar.',
};

function fileExtension(file: File): string {
    return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'pdf';
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    try {
        link.click();
    } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

export function ConsultationPackageDialog({sources, onClose}: Props) {
    const [preview] = useState(sources);
    const [selected, setSelected] = useState(() =>
        new Set(preview.filter(source => source.kind === 'attachment').map(source => source.key)));
    const [action, setAction] = useState<Action | null>(null);
    const [prepared, setPrepared] = useState<PreparedConsultation | null>(null);
    const [error, setError] = useState('');
    const owner = useRef(driveAuth.cachedAccountId());
    const dialog = useRef<HTMLDialogElement>(null);
    const cancelled = useRef(false);
    const busy = useRef(false);
    const latestSources = useRef(sources);
    latestSources.current = sources;
    const shareData: ShareData | null = prepared && {
        files: prepared.files.length ? prepared.files : undefined,
        text: prepared.links.join('\n') || undefined,
    };
    const canShare = shareData && typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' ||
            navigator.canShare(shareData.files ? {files: shareData.files} : shareData));
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

    function assertSelection() {
        if (owner.current === null || driveAuth.cachedAccountId() !== owner.current) throw new DriveSessionError();
        const latest = new Map(latestSources.current.map(source => [source.key, source]));
        if (preview.some(source => {
            if (!selected.has(source.key)) return false;
            const current = latest.get(source.key);
            return !current || current.href !== source.href ||
                (source.kind === 'attachment' && (current.kind !== 'attachment' ||
                    current.study.revision !== source.study.revision));
        })) throw new DriveConflictError();
    }

    async function run(nextAction: Action, work: () => Promise<void>) {
        if (busy.current || cancelled.current || selected.size === 0) return;
        busy.current = true;
        setAction(nextAction);
        setError('');
        try {
            await work();
        } catch (err) {
            if (cancelled.current || (nextAction === 'share' && err instanceof DOMException && err.name === 'AbortError')) return;
            if (err instanceof DriveConflictError) {
                setPrepared(null);
                setError('Una fuente seleccionada cambió. Cerrá esta vista y revisá los estudios del turno.');
            } else if (err instanceof DriveSessionError || err instanceof StudyAttachmentFormatError) {
                setPrepared(null);
                setError(err.message);
            } else {
                setError(actionErrors[nextAction]);
            }
        } finally {
            busy.current = false;
            if (!cancelled.current) setAction(null);
        }
    }

    async function verifyReady(token: string) {
        if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
        if (cancelled.current) return false;
        assertSelection();
        return true;
    }

    function prepare(nextAction: 'zip' | 'prepare') {
        return run(nextAction, async () => {
            const token = await driveAuth.getAccessToken();
            if (cancelled.current) return;
            assertSelection();
            const files: File[] = [];
            const links: string[] = [];
            for (const source of preview.filter(source => selected.has(source.key))) {
                if (cancelled.current) return;
                if (source.kind === 'viewer') {
                    links.push(source.href);
                } else {
                    const file = await readVerifiedStudyAttachment(source.study, token);
                    const name = `archivo-${files.length + 1}.${fileExtension(file)}`;
                    files.push(new File([file], name, {type: file.type}));
                }
            }
            if (cancelled.current) return;
            if (nextAction === 'prepare') {
                if (await verifyReady(token)) setPrepared({files, links, token});
                return;
            }

            const {default: JSZip} = await import('jszip');
            const archive = new JSZip();
            for (const file of files) {
                if (cancelled.current) return;
                archive.file(file.name, await file.arrayBuffer());
            }
            if (links.length) archive.file('enlaces.txt', `${links.join('\n')}\n`);
            const zip = await archive.generateAsync({type: 'blob'});
            if (await verifyReady(token)) downloadBlob(zip, 'consulta.zip');
        });
    }

    function share() {
        if (!prepared || !shareData || !canShare) return;
        return run('share', async () => {
            // Only check the local session here so the click still authorizes the native share menu.
            if (await verifyReady(prepared.token)) await navigator.share(shareData);
        });
    }

    return (
        <dialog ref={dialog} className="dialog" aria-label="Preparar consulta"
                onCancel={event => { event.preventDefault(); close(); }}>
            <form onSubmit={event => { event.preventDefault(); void prepare('zip'); }}>
                <div className="dialog-heading">
                    <div>
                        <h2 tabIndex={-1}>Preparar consulta</h2>
                        <p>Elegí los archivos y enlaces para descargar o compartir.</p>
                    </div>
                </div>
                <fieldset className="appointment-study-picker" disabled={action !== null}>
                    <legend>Fuentes de los estudios del turno</legend>
                    <div className="appointment-study-options">
                        {preview.map(source => (
                            <label key={source.key}>
                                <input type="checkbox" data-source={source.kind} checked={selected.has(source.key)}
                                       onChange={event => {
                                           const checked = event.currentTarget.checked;
                                           setPrepared(null);
                                           setError('');
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
                    {action === 'zip' ? 'Verificando los archivos y preparando el ZIP…'
                        : action === 'prepare' ? 'Verificando los archivos para compartir…'
                        : `${selected.size} ${selected.size === 1 ? 'fuente seleccionada' : 'fuentes seleccionadas'}`}
                </p>
                {prepared && (
                    <div>
                        <p className="appointment-note" role="status">
                            {canShare ? 'Elegí WhatsApp o tu app de correo en el menú para compartir.'
                                : prepared.files.length
                                    ? 'Este navegador no permite compartir estos archivos. Descargalos por separado para adjuntarlos en WhatsApp o en un correo.'
                                    : 'Este navegador no permite compartir los enlaces desde acá. Podés descargarlos en el ZIP.'}
                        </p>
                        {prepared.files.length > 0 && (
                            <div className="share-links" role="group" aria-label="Descargar archivos individuales">
                                {prepared.files.map(file => (
                                    <button key={file.name} type="button" className="button secondary button-sm" disabled={action !== null}
                                            onClick={() => void run('file', async () => {
                                                if (await verifyReady(prepared.token)) downloadBlob(file, file.name);
                                            })}>
                                        Descargar {file.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="dialog-actions">
                    <button type="button" className="button secondary" onClick={close}>Cerrar</button>
                    <button type="submit" className="button secondary" disabled={action !== null || !selected.size}>
                        Descargar ZIP
                    </button>
                    {prepared ? canShare && (
                        <button type="button" className="button primary" disabled={action !== null} onClick={() => void share()}>
                            {prepared.files.length ? 'Compartir archivos' : 'Compartir enlaces'}
                        </button>
                    ) : (
                        <button type="button" className="button primary" disabled={action !== null || !selected.size}
                                onClick={() => void prepare('prepare')}>
                            Preparar para compartir
                        </button>
                    )}
                </div>
            </form>
        </dialog>
    );
}
