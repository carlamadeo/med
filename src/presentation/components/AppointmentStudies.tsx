import {useState} from 'preact/hooks';
import {filterStudiesByQuery, formatStudyDate, hasStudyAttachment, reportUrl} from '@domain/library';
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
    const available = studies.value.toSorted((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'));
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

export function PrepareAppointment({studyIds}: { studyIds?: readonly string[] }) {
    const [preparing, setPreparing] = useState(false);
    if (!studyIds?.length || isLocalDemo.value) return null;

    const sources: ConsultationSource[] = [];
    if (!offline.value) {
        const byId = new Map(studies.value.map(study => [study.id, study]));
        const pending = pendingChanges.value;
        const changedAttachments = new Set(pending.filter(entry => entry.kind === 'delete' ||
            entry.attachment || entry.draft?.removeReport).map(entry => entry.studyId));
        const deletedStudies = new Set(pending.filter(entry => entry.kind === 'delete').map(entry => entry.studyId));
        const changedViewers = new Set(pending.filter(entry => entry.kind === 'save' && entry.studyId &&
            entry.draft && entry.draft.viewer !== byId.get(entry.studyId)?.viewer).map(entry => entry.studyId));
        const attachments = new Map<string, ConsultationSource>();
        const viewers = new Map<string, ConsultationSource>();

        function addAttachment(study: Study | undefined) {
            if (!study || changedAttachments.has(study.id) || !hasStudyAttachment(study) ||
                isSourceUnavailable(study.driveFileId)) return;
            const key = `attachment:${study.driveFileId}`;
            if (!attachments.has(key)) {
                attachments.set(key, {
                    key, kind: 'attachment', study, title: study.title, href: reportUrl(study.driveFileId),
                });
            }
        }

        for (const id of studyIds) {
            const study = byId.get(id);
            if (!study || deletedStudies.has(id)) continue;
            addAttachment(study);
            for (const documentId of study.documentIds ?? []) addAttachment(byId.get(documentId));

            if (study.viewer && !changedViewers.has(id) && !isSourceUnavailable(study.viewer)) {
                const key = `viewer:${study.viewer}`;
                if (!viewers.has(key)) {
                    viewers.set(key, {key, kind: 'viewer', title: study.title, href: study.viewer});
                }
            }
        }

        sources.push(...attachments.values(), ...viewers.values());
    }

    return (
        <>
            {sources.length > 0 && (
                <button
                    type="button"
                    className="button ghost button-sm appointment-prepare"
                    onClick={() => setPreparing(true)}
                >
                    Preparar consulta
                </button>
            )}
            {preparing && <ConsultationPackageDialog sources={sources} onClose={() => setPreparing(false)}/>}
        </>
    );
}
