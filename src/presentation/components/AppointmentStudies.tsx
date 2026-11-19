import {useState} from 'preact/hooks';
import {filterStudiesByQuery, formatStudyDate, hasStudyAttachment, reportUrl, studyAttachmentLabel} from '@domain/library';
import type {Study} from '@domain/models';
import {isLocalDemo, isSourceUnavailable, offline, pendingChanges, studies} from '../state/store';
import {ConsultationPackageDialog, type ConsultationSource} from './ConsultationPackageDialog';

interface AppointmentStudyPickerProps {
    studyIds?: readonly string[];
    disabled?: boolean;
}

export function AppointmentStudyPicker({studyIds = [], disabled}: AppointmentStudyPickerProps) {
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(30);
    const [selected, setSelected] = useState(() => new Set(studyIds));
    const available = [...studies.value].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'));
    const byId = new Set(available.map(study => study.id));
    const missing = [...selected].filter(id => !byId.has(id));
    const matches = filterStudiesByQuery(available, query);
    const visible = matches.slice(0, limit);
    const visibleIds = new Set(visible.map(study => study.id));
    const hidden = [...selected].filter(id => byId.has(id) && !visibleIds.has(id));
    const toggle = (id: string, checked: boolean) => setSelected(previous => {
        const next = new Set(previous);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
    });

    return (
        <fieldset className="appointment-study-picker" disabled={disabled}>
            <legend>Estudios para llevar</legend>
            {available.length > 0 && (
                <label className="field">
                    <span>Buscar estudios para el turno</span>
                    <input type="search" value={query} onInput={event => {
                        setQuery(event.currentTarget.value);
                        setLimit(30);
                    }}/>
                </label>
            )}
            {hidden.map(id => <input key={id} type="hidden" name="studyId" value={id}/>)}
            {available.length || missing.length ? (
                <div className="appointment-study-options">
                    {visible.map(study => (
                        <label key={study.id}>
                            <input type="checkbox" name="studyId" value={study.id}
                                   checked={selected.has(study.id)}
                                   onChange={event => toggle(study.id, event.currentTarget.checked)}/>
                            <span>{study.title} · {formatStudyDate(study.date)}</span>
                        </label>
                    ))}
                    {missing.map(id => (
                        <label key={id}>
                            <input type="checkbox" name="studyId" value={id} checked
                                   onChange={event => toggle(id, event.currentTarget.checked)}/>
                            <span>Estudio no disponible</span>
                        </label>
                    ))}
                </div>
            ) : <p className="appointment-note">Todavía no hay estudios para elegir.</p>}
            {available.length > 0 && <p className="appointment-note" role="status">
                {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
                {matches.length === 0 ? ' · Sin coincidencias' : ''}
            </p>}
            {matches.length > visible.length && (
                <button type="button" className="button secondary" onClick={() => setLimit(limit + 30)}>
                    Mostrar más estudios
                </button>
            )}
        </fieldset>
    );
}

export function AppointmentStudyList({studyIds}: {studyIds?: readonly string[]}) {
    const [preparing, setPreparing] = useState(false);
    if (!studyIds?.length) return null;
    const byId = new Map(studies.value.map(study => [study.id, study]));
    const pending = pendingChanges.value;
    const isOffline = offline.value;
    const changedAttachments = new Set(pending.filter(entry => entry.kind === 'delete' ||
        entry.attachment || entry.draft?.removeReport).map(entry => entry.studyId));
    const deletedStudies = new Set(pending.filter(entry => entry.kind === 'delete').map(entry => entry.studyId));
    const changedViewers = new Set(pending.filter(entry => entry.kind === 'save' && entry.studyId &&
        entry.draft && entry.draft.viewer !== byId.get(entry.studyId)?.viewer).map(entry => entry.studyId));
    const attachments = new Map<string, ConsultationSource>();
    const viewers = new Map<string, ConsultationSource>();
    const addAttachment = (document: Study) => {
        const key = `attachment:${document.driveFileId}`;
        if (attachments.has(key)) return false;
        attachments.set(key, {
            key, kind: 'attachment', study: document, title: document.title, href: reportUrl(document.driveFileId),
        });
        return true;
    };
    const rows = [...new Set(studyIds)].map(id => {
        const study = byId.get(id);
        if (!study) return <li key={id}>Estudio no disponible</li>;
        if (deletedStudies.has(id)) return (
            <li key={id}>
                <span>{study.title}</span>
                <span className="appointment-study-note">Eliminación pendiente de sincronización</span>
            </li>
        );

        const pendingFileChange = changedAttachments.has(id);
        const hasAttachment = hasStudyAttachment(study);
        const associated = [...new Set(study.documentIds ?? [])];
        const attachmentNote = pendingFileChange ? 'Archivo pendiente de sincronización'
            : !hasAttachment ? (study.viewer || associated.length ? null : 'Sin archivo adjunto')
                : isSourceUnavailable(study.driveFileId) ? 'Archivo no disponible'
                    : isOffline ? 'Conectate para abrir el archivo' : null;
        const viewerNote = changedViewers.has(id) ? 'Visor pendiente de sincronización'
            : !study.viewer ? null
                : isSourceUnavailable(study.viewer) ? 'Visor no disponible'
                    : isOffline ? 'Conectate para abrir el visor' : null;
        const showAttachment = hasAttachment && !attachmentNote && addAttachment(study);
        const viewerKey = `viewer:${study.viewer}`;
        const showViewer = study.viewer && !viewerNote && !viewers.has(viewerKey);
        if (showViewer) {
            viewers.set(viewerKey, {
                key: viewerKey, kind: 'viewer', title: study.title, href: study.viewer,
            });
        }

        return (
            <li key={id}>
                <span>{study.title}</span>
                {attachmentNote && <span className="appointment-study-note">{attachmentNote}</span>}
                {showAttachment && (
                    <a href={reportUrl(study.driveFileId)} target="_blank" rel="noopener noreferrer"
                       aria-label={`${studyAttachmentLabel(study)} de ${study.title}`}>
                        {studyAttachmentLabel(study)}
                    </a>
                )}
                {viewerNote && <span className="appointment-study-note">{viewerNote}</span>}
                {showViewer && (
                    <a href={study.viewer} target="_blank" rel="noopener noreferrer"
                       aria-label={`Abrir visor de ${study.title}`}>Abrir visor</a>
                )}
                {associated.map(documentId => {
                    const document = byId.get(documentId);
                    const pendingDocument = changedAttachments.has(documentId);
                    const label = document?.title ?? 'Documento asociado';
                    if (pendingDocument) return <span key={documentId} className="appointment-study-note">{label} · Pendiente de sincronización</span>;
                    if (!document || !hasStudyAttachment(document) || isSourceUnavailable(document.driveFileId)) {
                        return <span key={documentId} className="appointment-study-note">{label} · Archivo no disponible</span>;
                    }
                    if (isOffline) return <span key={documentId} className="appointment-study-note">{label} · Conectate para abrir el archivo</span>;
                    if (!addAttachment(document)) return null;
                    const action = studyAttachmentLabel(document);
                    return <a key={documentId} href={reportUrl(document.driveFileId)} target="_blank"
                              rel="noopener noreferrer" aria-label={`${action} de ${label}`}>{action} · {label}</a>;
                })}
            </li>
        );
    });
    const sources = [...attachments.values(), ...viewers.values()];

    return (
        <div className="appointment-studies">
            <p>Estudios para llevar</p>
            <ul className="appointment-study-list">
                {rows}
            </ul>
            {sources.length > 0 && !isLocalDemo.value && (
                <button type="button" className="button secondary button-sm" onClick={() => setPreparing(true)}>
                    Preparar consulta
                </button>
            )}
            {preparing && <ConsultationPackageDialog sources={sources} onClose={() => setPreparing(false)}/>}
        </div>
    );
}
