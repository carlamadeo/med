import {useEffect, useRef, useState} from 'preact/hooks';
import {analyzePdf, validateDocument} from '@data/pdf-analysis';
import {driveAuth, driveStudyRepo} from '@data';
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

export function StudyImportDialog({open, onClose, studies, onSaved}: Props) {
    const [rows, setRows] = useState<Row[]>([]);
    const [institution, setInstitution] = useState('');
    const [saving, setSaving] = useState(false);
    const [sessionVisible, setSessionVisible] = useState(true);
    const rowsRef = useRef<Row[]>([]);
    const owner = useRef<string | null>(null);
    const generation = useRef(0);
    const controller = useRef<AbortController | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
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
            setSessionVisible(false);
        } else {
            void driveAuth.getAccountId().then(account => {
                if (owner.current && owner.current !== account) clear();
                setSessionVisible(true);
            }).catch(() => setSessionVisible(false));
        }
    }), []);
    useEffect(() => () => { generation.current++; controller.current?.abort(); previewUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

    const add = async (files: FileList | File[]) => {
        if (reading.current) return;
        reading.current = true;
        try {
        const account = driveAuth.cachedAccountId() ?? await driveAuth.getAccountId();
        if (owner.current && owner.current !== account) clear();
        owner.current = account;
        const version = generation.current;
        const added = Array.from(files).map(file => ({
            key: crypto.randomUUID(), file, selected: true, status: 'waiting' as const, message: '', duplicateConfirmed: '',
            draft: {title: file.name.replace(/\.pdf$/i, ''), date: '', types: [], doctor: '', portal: '', viewer: '', reportName: file.name, file},
        }));
        update(current => [...current, ...added]);
        for (const item of added) {
            if (version !== generation.current) return;
            patch(item.key, {status: 'reading', message: 'Leyendo informe…'});
            const abort = new AbortController();
            controller.current = abort;
            const timeout = window.setTimeout(() => abort.abort(), 45000);
            try {
                if (await validateDocument(item.file) !== 'application/pdf') throw new Error('Elegí un PDF válido.');
                const bytes = await item.file.arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                const found = await analyzePdf(item.file, abort.signal, () => {}, progress => {
                    if (version === generation.current) patch(item.key, {message: `Leyendo página ${progress.page} de ${progress.total}…`});
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
        } finally { reading.current = false; }
    };
    const edit = (row: Row, changes: Partial<StudyDraft>) => patch(row.key, {draft: {...row.draft, ...changes}, duplicateConfirmed: ''});
    const duplicate = (row: Row) => studies.find(study => study.date === row.draft.date && row.draft.date && ((normalize(row.draft.title) && normalize(study.title) === normalize(row.draft.title)) || (normalize(study.reportName) && normalize(study.reportName) === normalize(row.file.name))));
    const identical = (row: Row) => row.hash && rows.find(other => other.key !== row.key && other.hash === row.hash && rows.indexOf(other) < rows.indexOf(row));
    const ready = (row: Row) => row.status === 'ready' && !validateStudyDraft(row.draft).length && !identical(row) && (!duplicate(row) || row.duplicateConfirmed === duplicate(row)?.id);
    const save = async () => {
        if (busy.current || !owner.current) return;
        busy.current = true;
        setSaving(true);
        const account = owner.current;
        const version = generation.current;
        try {
            const token = await driveAuth.getAccessToken();
            for (const row of rowsRef.current.filter(item => item.selected && (ready(item) || item.status === 'uncertain'))) {
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
        if (saving) return;
        if (rowsRef.current.some(row => row.status !== 'saved') && !window.confirm('¿Descartar los estudios pendientes de esta tanda?')) return;
        clear(); onClose();
    };
    return <dialog ref={dialog} className="dialog" aria-labelledby="import-title" onCancel={event => {event.preventDefault(); close();}}>
        <div className="dialog-heading"><h2 id="import-title">Importar estudios</h2><button type="button" onClick={close}>Cerrar</button></div>
        {sessionVisible ? <div onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); if (!saving && event.dataTransfer?.files) void add(event.dataTransfer.files);}}>
            <label>Elegí los PDF <input type="file" accept="application/pdf,.pdf" multiple disabled={saving} onChange={event => {const input = event.currentTarget; if (input.files) void add(input.files); input.value = '';}} /></label>
            <p>También podés arrastrar los PDF aquí.</p>
            <div className="form-grid-2"><label>Institución <input value={institution} onInput={event => setInstitution(event.currentTarget.value)} /></label><button type="button" disabled={saving} onClick={() => update(current => current.map(row => row.selected && row.status !== 'saved' && !row.submitted ? {...row, draft: {...row.draft, portal: institution}} : row))}>Aplicar a seleccionados</button></div>
            <button type="button" disabled={saving || !rows.some(ready)} onClick={() => update(current => current.map(row => ({...row, selected: ready(row)})))}>Seleccionar listas</button>
            {rows.map(row => <section key={row.key} className="form-section">
                <label><input type="checkbox" checked={row.selected} disabled={saving || row.status === 'saved'} onChange={event => patch(row.key, {selected: event.currentTarget.checked})} /> {row.file.name}</label>
                <p role="status">{row.message}{identical(row) ? ' Archivo idéntico a otro de esta tanda.' : ''}</p>
                {row.status !== 'error' && row.status !== 'waiting' && row.status !== 'reading' && <button type="button" onClick={() => {const url = URL.createObjectURL(new Blob([row.file], {type: 'application/pdf'})); previewUrls.current.push(url); window.open(url, '_blank', 'noopener,noreferrer');}}>Abrir PDF</button>}
                {duplicate(row) && <label><input type="checkbox" checked={row.duplicateConfirmed === duplicate(row)?.id} onChange={event => patch(row.key, {duplicateConfirmed: event.currentTarget.checked ? duplicate(row)?.id ?? '' : ''})} /> Posible duplicado de {duplicate(row)?.title}. Confirmar que es otro estudio.</label>}
                <fieldset disabled={saving || row.status === 'saved' || Boolean(row.submitted)}>
                    <label>Nombre <input value={row.draft.title} onInput={event => edit(row, {title: event.currentTarget.value})} /></label>
                    <label>Fecha <input type="date" value={row.draft.date} onInput={event => edit(row, {date: event.currentTarget.value})} /></label>
                    <label>Tipo <input value={row.draft.types.join(', ')} onInput={event => edit(row, {types: event.currentTarget.value.split(',').map(value => value.trim()).filter(Boolean)})} /></label>
                    <label>Profesional <input value={row.draft.doctor} onInput={event => edit(row, {doctor: event.currentTarget.value})} /></label>
                    <label>Institución <input value={row.draft.portal} onInput={event => edit(row, {portal: event.currentTarget.value})} /></label>
                </fieldset>
            </section>)}
            <p>{rows.filter(row => row.selected && (ready(row) || row.status === 'uncertain')).length} estudios listos para guardar</p>
            <button type="button" disabled={saving || !rows.some(row => row.selected && (ready(row) || row.status === 'uncertain'))} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar estudios seleccionados'}</button>
        </div> : <p>Volvé a conectar la misma cuenta para continuar.</p>}
    </dialog>;
}
