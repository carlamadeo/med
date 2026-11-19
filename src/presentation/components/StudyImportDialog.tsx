import {useEffect, useRef, useState} from 'preact/hooks';
import {analyzePdf, validateDocument} from '@data/pdf-analysis';
import {driveAuth, driveStudyRepo} from '@data';
import {formatStudyDate} from '@domain/library';
import {validateStudyDraft} from '@domain/validation/study';
import {normalize} from '@domain/utils';
import type {Study, StudyDraft} from '@domain/models';
import {useFocusTrap} from '../utils/focusTrap';

interface Row {
    key: string;
    file: File;
    draft: StudyDraft;
    selected: boolean;
    status: 'waiting' | 'reading' | 'ready' | 'error' | 'saved' | 'uncertain';
    message: string;
    hash?: string;
    submitted?: StudyDraft;
    duplicateConfirmed: string;
}

interface Props {
    open: boolean;
    onClose: () => void;
    studies: Study[];
    onSaved: (study: Study) => void;
}

const statusLabels = {
    waiting: 'En espera',
    reading: 'Analizando PDF',
    ready: 'Listo',
    review: 'Por revisar',
    repeated: 'Archivo repetido',
    error: 'Error de lectura',
    saving: 'Guardando…',
    saved: 'Guardado',
    uncertain: 'Guardado sin confirmar',
};

export function StudyImportDialog({open, onClose, studies, onSaved}: Props) {
    const [rows, setRows] = useState<Row[]>([]);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [institution, setInstitution] = useState('');
    const [bulkOpen, setBulkOpen] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [saving, setSaving] = useState(false);
    const [sessionVisible, setSessionVisible] = useState(true);
    const rowsRef = useRef<Row[]>([]);
    const owner = useRef<string | null>(null);
    const generation = useRef(0);
    const controller = useRef<AbortController | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const bulkButton = useRef<HTMLButtonElement>(null);
    const busy = useRef(false);
    const reading = useRef(false);
    const previewUrls = useRef<string[]>([]);
    useFocusTrap(dialog, open);
    const update = (fn: (current: Row[]) => Row[]) => {
        const next = fn(rowsRef.current);
        rowsRef.current = next;
        setRows(next);
    };
    const patch = (key: string, changes: Partial<Row>) => update(current => current.map(row => row.key === key ? {...row, ...changes} : row));
    const clear = () => {
        generation.current++;
        controller.current?.abort();
        previewUrls.current.forEach(url => URL.revokeObjectURL(url));
        previewUrls.current = [];
        owner.current = null;
        update(() => []);
        setExpandedKey(null);
        setInstitution('');
        setBulkOpen(false);
        setDragging(false);
    };
    useEffect(() => {
        if (open) dialog.current?.showModal();
        else dialog.current?.close();
    }, [open]);
    useEffect(() => driveAuth.onAuthChange(signedIn => {
        if (!signedIn) {
            generation.current++;
            controller.current?.abort();
            previewUrls.current.forEach(url => URL.revokeObjectURL(url));
            previewUrls.current = [];
            update(current => current.map(row => row.status === 'reading' || row.status === 'waiting' ? {...row, status: 'error', message: 'Se interrumpió la lectura. Volvé a agregar el archivo.'} : row));
            setDragging(false);
            setSessionVisible(false);
        } else {
            void driveAuth.getAccountId().then(account => {
                if (owner.current && owner.current !== account) clear();
                setSessionVisible(true);
            }).catch(() => setSessionVisible(false));
        }
    }), []);
    useEffect(() => () => { generation.current++; controller.current?.abort(); previewUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

    const add = async (files: File[]) => {
        if (!files.length || reading.current || busy.current || !sessionVisible) return;
        reading.current = true;
        setProcessing(true);
        const startVersion = generation.current;
        try {
            const account = driveAuth.cachedAccountId() ?? await driveAuth.getAccountId();
            if (startVersion !== generation.current) return;
            if (owner.current && owner.current !== account) clear();
            owner.current = account;
            const version = generation.current;
            const added = files.map(file => ({
                key: crypto.randomUUID(), file, selected: true, status: 'waiting' as const, message: '', duplicateConfirmed: '',
                draft: {title: file.name.replace(/\.pdf$/i, ''), date: '', types: [], doctor: '', portal: '', viewer: '', reportName: file.name, file},
            }));
            update(current => [...current, ...added]);
            for (const item of added) {
                if (version !== generation.current) return;
                patch(item.key, {status: 'reading'});
                const abort = new AbortController();
                controller.current = abort;
                const timeout = window.setTimeout(() => abort.abort(), 45000);
                try {
                    if (await validateDocument(item.file) !== 'application/pdf') throw new Error('Elegí un PDF válido.');
                    const bytes = await item.file.arrayBuffer();
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                    const found = await analyzePdf(item.file, abort.signal, () => {}, progress => {
                        if (version === generation.current) patch(item.key, {message: `Página ${progress.page} de ${progress.total}`});
                    });
                    if (version !== generation.current) return;
                    update(current => current.map(row => row.key === item.key ? {...row, hash, status: 'ready', message: '', draft: {
                        ...row.draft,
                        date: row.draft.date || found.date || '',
                        types: row.draft.types.length ? row.draft.types : found.types || [],
                        doctor: row.draft.doctor || found.doctor || '',
                    }} : row));
                } catch {
                    if (version !== generation.current) return;
                    patch(item.key, {status: 'error', message: abort.signal.aborted ? 'La lectura tardó demasiado. Volvé a agregar el archivo.' : 'No se pudo abrir el PDF.'});
                } finally {
                    window.clearTimeout(timeout);
                    if (controller.current === abort) controller.current = null;
                }
            }
        } catch {
            if (startVersion === generation.current) setSessionVisible(false);
        } finally {
            reading.current = false;
            setProcessing(false);
        }
    };
    const edit = (row: Row, changes: Partial<StudyDraft>) => patch(row.key, {draft: {...row.draft, ...changes}, duplicateConfirmed: ''});
    const duplicate = (row: Row) => {
        if (!row.draft.date) return;
        const title = normalize(row.draft.title);
        const filename = normalize(row.file.name);
        return studies.find(study => study.date === row.draft.date && (
            (title && normalize(study.title) === title) || (filename && normalize(study.reportName) === filename)
        ));
    };
    const identical = (row: Row) => Boolean(row.hash && rows.find(other => other.hash === row.hash)?.key !== row.key);
    const editable = (row: Row) => row.status === 'ready' && !identical(row);
    const ready = (row: Row) => {
        if (!editable(row) || validateStudyDraft(row.draft).length) return false;
        const match = duplicate(row);
        return !match || row.duplicateConfirmed === match.id;
    };
    const canSave = (row: Row) => row.selected && (ready(row) || row.status === 'uncertain');
    const save = async () => {
        if (busy.current || !owner.current) return;
        busy.current = true;
        setSaving(true);
        const account = owner.current;
        const version = generation.current;
        try {
            const token = await driveAuth.getAccessToken();
            for (const row of rowsRef.current.filter(canSave)) {
                if (generation.current !== version || driveAuth.cachedAccountId() !== account) break;
                try {
                    const draft = row.submitted ?? {...row.draft, id: await driveStudyRepo.reserveId(token)};
                    patch(row.key, {submitted: draft, status: 'uncertain', message: 'Guardando…'});
                    const saved = await driveStudyRepo.save(draft, token);
                    if (generation.current !== version || driveAuth.cachedAccountId() !== account || await driveAuth.getAccessToken() !== token) break;
                    patch(row.key, {status: 'saved', selected: false, message: 'Guardado'});
                    onSaved(saved);
                } catch {
                    if (generation.current !== version || driveAuth.cachedAccountId() !== account) break;
                    patch(row.key, {status: 'uncertain', message: 'No se pudo confirmar el guardado. Reintentá con la misma cuenta.'});
                    break;
                }
            }
        } catch {
            if (generation.current === version) setSessionVisible(false);
        } finally { busy.current = false; setSaving(false); }
    };
    const close = () => {
        if (busy.current) return;
        if (rowsRef.current.some(row => row.status !== 'saved') && !window.confirm('¿Descartar los estudios pendientes de esta tanda?')) return;
        clear(); onClose();
    };
    const preview = (file: File) => {
        const url = URL.createObjectURL(new Blob([file], {type: 'application/pdf'}));
        previewUrls.current.push(url);
        window.open(url, '_blank', 'noopener,noreferrer');
    };
    const canApplyInstitution = (row: Row) => row.selected && editable(row);
    const hasEditableRows = rows.some(editable);
    const canSelectReady = rows.some(ready) && rows.some(row => editable(row) && row.selected !== ready(row));
    const readyCount = rows.filter(row => row.selected && ready(row)).length;
    const retryCount = rows.filter(row => row.selected && row.status === 'uncertain').length;
    const savedCount = rows.filter(row => row.status === 'saved').length;
    const pendingCount = rows.length - savedCount;
    const summary = savedCount && !saving
        ? pendingCount
            ? `${savedCount} ${savedCount === 1 ? 'estudio guardado' : 'estudios guardados'}. ${pendingCount} ${pendingCount === 1 ? 'estudio pendiente' : 'estudios pendientes'}.`
            : savedCount === 1 ? 'Se guardó el estudio correctamente.' : `Se guardaron los ${savedCount} estudios correctamente.`
        : '';

    return (
        <dialog ref={dialog} className="dialog study-import-dialog" aria-labelledby="import-title"
            onCancel={event => { event.preventDefault(); close(); }}
            onDragOver={event => {
                if (!event.dataTransfer?.types.includes('Files')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = saving || processing || !sessionVisible ? 'none' : 'copy';
                setDragging(event.dataTransfer.dropEffect === 'copy');
            }}
            onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={event => {
                event.preventDefault();
                setDragging(false);
                void add(Array.from(event.dataTransfer?.files ?? []));
            }}
        >
            <div className="dialog-heading study-import-header">
                <div>
                    <h2 id="import-title">Importar estudios</h2>
                    <p>Cada PDF se agrega como un estudio.</p>
                </div>
                <button className="icon-button" type="button" aria-label="Cerrar" disabled={saving} onClick={close}>
                    <svg className="icon" aria-hidden="true"><use href="#i-close" /></svg>
                </button>
            </div>
            <div className="study-import-body">
                {sessionVisible ? <>
                    <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden
                        disabled={saving || processing} onChange={event => {
                            const input = event.currentTarget;
                            void add(Array.from(input.files ?? []));
                            input.value = '';
                        }} />
                    <div className="study-import-drop" data-empty={!rows.length} data-dragging={dragging}>
                        <div className="study-import-drop-label">
                            <span className="study-import-drop-icon"><svg className="icon" aria-hidden="true"><use href="#i-upload" /></svg></span>
                            <strong>{processing ? 'Analizando los PDF…' : rows.length ? 'Arrastrá más PDF acá' : 'Arrastrá los PDF acá'}</strong>
                        </div>
                        <button className={`button ${rows.length ? 'secondary' : 'primary'}`} type="button"
                            disabled={saving || processing} onClick={() => fileInput.current?.click()}>{rows.length ? 'Agregar PDF' : 'Elegir PDF'}</button>
                    </div>

                    {rows.length > 0 && <div className="study-import-files">
                        <div className="study-import-toolbar">
                            <h3>{rows.length} {rows.length === 1 ? 'archivo' : 'archivos'}</h3>
                            <div className="study-import-tools">
                                {canSelectReady && <button className="button ghost" type="button" disabled={saving} onClick={() => {
                                    update(current => current.map(row => row.status === 'uncertain' ? row : {...row, selected: ready(row)}));
                                }}>Seleccionar estudios listos</button>}
                                {hasEditableRows && <button ref={bulkButton} className="button ghost" type="button" disabled={saving}
                                        aria-expanded={bulkOpen} aria-controls={bulkOpen ? 'import-institution' : undefined}
                                        onClick={() => setBulkOpen(!bulkOpen)}>Institución en lote</button>}
                            </div>
                        </div>
                        {bulkOpen && hasEditableRows && <div className="study-import-bulk" id="import-institution">
                            <label>Institución común <input value={institution} disabled={saving} onInput={event => setInstitution(event.currentTarget.value)} /></label>
                            <button className="button secondary" type="button" disabled={saving || !rows.some(canApplyInstitution)} onClick={() => {
                                update(current => current.map(row => canApplyInstitution(row) ? {...row, draft: {...row.draft, portal: institution}} : row));
                                setBulkOpen(false);
                                bulkButton.current?.focus();
                            }}>Aplicar a seleccionados</button>
                        </div>}

                        {rows.map(row => {
                            const repeated = identical(row);
                            const canEdit = row.status === 'ready' && !repeated;
                            const expanded = canEdit && expandedKey === row.key;
                            const match = canEdit ? duplicate(row) : undefined;
                            const needsConfirmation = match && row.duplicateConfirmed !== match.id;
                            const validationError = canEdit ? validateStudyDraft(row.draft)[0] : undefined;
                            const removable = repeated || row.status === 'error';
                            let status: keyof typeof statusLabels = row.status;
                            if (repeated) status = 'repeated';
                            else if (validationError || needsConfirmation) status = 'review';
                            else if (row.status === 'uncertain' && saving) status = 'saving';
                            let message = status === 'saved' || status === 'saving' ? '' : row.message;
                            if (repeated) message = 'Archivo idéntico a otro de esta tanda.';
                            else if (needsConfirmation) message = `Posible duplicado de ${match.title}.`;
                            else if (validationError) message = validationError;
                            const icon = row.status === 'saved' ? 'check' : removable ? 'alert' : 'file';
                            return <section key={row.key} className="study-import-row" aria-label={row.file.name} data-expanded={expanded}>
                                <div className="study-import-row-summary">
                                    {canEdit || row.status === 'uncertain' ?
                                        <label className="study-import-checkbox">
                                            <input type="checkbox" checked={row.selected} disabled={saving} aria-label={`Seleccionar ${row.file.name}`}
                                                onChange={event => patch(row.key, {selected: event.currentTarget.checked})} />
                                        </label> :
                                        <svg className="icon study-import-row-icon" aria-hidden="true"><use href={`#i-${icon}`} /></svg>}
                                    <div className="study-import-file">
                                        <h4>{row.file.name}</h4>
                                        <div className="study-import-meta">
                                            <span className="study-import-status" data-status={status}>{statusLabels[status]}</span>
                                            {(status === 'ready' || status === 'saved') && <time dateTime={row.draft.date}>{formatStudyDate(row.draft.date)}</time>}
                                        </div>
                                        {message && <p className="study-import-message">{message}</p>}
                                    </div>
                                    <div className="study-import-row-actions">
                                        {canEdit && <button className={`button ${status === 'review' ? 'secondary' : 'ghost'}`} type="button"
                                            disabled={saving} aria-expanded={expanded} aria-controls={expanded ? `import-fields-${row.key}` : undefined}
                                            aria-label={`${expanded ? 'Ocultar datos de' : 'Revisar'} ${row.file.name}`} onClick={() => setExpandedKey(expanded ? null : row.key)}>
                                            {expanded ? 'Ocultar' : 'Revisar'}
                                        </button>}
                                        {removable && <button className="button ghost" type="button" disabled={saving} aria-label={`Quitar ${row.file.name}`}
                                            onClick={() => update(current => current.filter(item => item.key !== row.key))}>Quitar</button>}
                                        {(row.status === 'saved' || row.status === 'uncertain') && <button className="button ghost" type="button"
                                            aria-label={`Abrir PDF ${row.file.name}`} onClick={() => preview(row.file)}>Abrir PDF</button>}
                                    </div>
                                </div>
                                {expanded && <div className="study-import-review" id={`import-fields-${row.key}`}>
                                    <fieldset className="form-grid-2" disabled={saving}>
                                        <legend className="sr-only">Datos de {row.file.name}</legend>
                                        <label>Nombre <input required value={row.draft.title} onInput={event => edit(row, {title: event.currentTarget.value})} /></label>
                                        <label>Fecha <input required type="date" value={row.draft.date} onInput={event => edit(row, {date: event.currentTarget.value})} /></label>
                                        <label>Tipos de estudio <input required defaultValue={row.draft.types.join(', ')}
                                            aria-describedby={`import-types-${row.key}`} onInput={event => edit(row, {types: event.currentTarget.value.split(',').map(value => value.trim()).filter(Boolean)})} />
                                            <small id={`import-types-${row.key}`}>Separá los tipos con comas.</small>
                                        </label>
                                        <label>Profesional <input value={row.draft.doctor} onInput={event => edit(row, {doctor: event.currentTarget.value})} /></label>
                                        <label>Institución <input value={row.draft.portal} onInput={event => edit(row, {portal: event.currentTarget.value})} /></label>
                                    </fieldset>
                                    {match && <label className="study-import-confirm">
                                        <input type="checkbox" disabled={saving} checked={row.duplicateConfirmed === match.id}
                                            onChange={event => patch(row.key, {duplicateConfirmed: event.currentTarget.checked ? match.id : ''})} />
                                        Es otro estudio, distinto de {match.title}.
                                    </label>}
                                    <button type="button" className="button secondary" onClick={() => preview(row.file)}>
                                        <svg className="icon" aria-hidden="true"><use href="#i-external" /></svg> Abrir PDF
                                    </button>
                                </div>}
                            </section>;
                        })}
                    </div>}
                </> : <p>Volvé a conectar la misma cuenta para continuar.</p>}
            </div>
            {sessionVisible && rows.length > 0 && <div className="study-import-footer">
                <div role="status">
                    {saving && <p>Guardando estudios…</p>}
                    {summary && <p>{summary}</p>}
                    {pendingCount > 0 && !saving && <>
                        <p>{readyCount === 1 ? '1 estudio listo para guardar' : `${readyCount} estudios listos para guardar`}</p>
                        {retryCount > 0 && <p>{retryCount === 1 ? '1 guardado por confirmar' : `${retryCount} guardados por confirmar`}</p>}
                    </>}
                </div>
                {pendingCount > 0 || saving ?
                    <button className="button primary" type="button" disabled={saving || !(readyCount + retryCount)} onClick={() => void save()}>
                        {saving ? 'Guardando…' : !readyCount && retryCount ? 'Reintentar guardado' : 'Guardar selección'}
                    </button> :
                    <button className="button primary" type="button" onClick={close}>Listo</button>}
            </div>}
        </dialog>
    );
}
