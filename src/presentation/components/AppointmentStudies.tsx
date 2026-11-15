import {formatStudyDate, hasStudyAttachment, reportUrl, studyAttachmentLabel} from '@domain/library';
import {isSourceUnavailable, offline, pendingChanges, studies} from '../state/store';

interface AppointmentStudyPickerProps {
    studyIds?: readonly string[];
    disabled?: boolean;
}

export function AppointmentStudyPicker({studyIds = [], disabled}: AppointmentStudyPickerProps) {
    const available = [...studies.value].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'));
    const selected = new Set(studyIds);
    const missing = [...selected].filter(id => !available.some(study => study.id === id));

    return (
        <fieldset className="appointment-study-picker" disabled={disabled}>
            <legend>Estudios para llevar</legend>
            {available.length || missing.length ? (
                <div className="appointment-study-options">
                    {available.map(study => (
                        <label key={study.id}>
                            <input type="checkbox" name="studyId" value={study.id}
                                   defaultChecked={selected.has(study.id)}/>
                            <span>{study.title} · {formatStudyDate(study.date)}</span>
                        </label>
                    ))}
                    {missing.map(id => (
                        <label key={id}>
                            <input type="checkbox" name="studyId" value={id} defaultChecked/>
                            <span>Estudio no disponible</span>
                        </label>
                    ))}
                </div>
            ) : <p className="appointment-note">Todavía no hay estudios para elegir.</p>}
        </fieldset>
    );
}

export function AppointmentStudyList({studyIds}: {studyIds?: readonly string[]}) {
    if (!studyIds?.length) return null;
    const byId = new Map(studies.value.map(study => [study.id, study]));
    const pending = pendingChanges.value;
    const isOffline = offline.value;

    return (
        <div className="appointment-studies">
            <p>Estudios para llevar</p>
            <ul className="appointment-study-list">
                {[...new Set(studyIds)].map(id => {
                    const study = byId.get(id);
                    if (!study) return <li key={id}>Estudio no disponible</li>;

                    const pendingFileChange = pending.some(entry => entry.studyId === id && (
                        entry.kind === 'delete' || entry.attachment || entry.draft?.removeReport
                    ));
                    const hasAttachment = hasStudyAttachment(study);
                    const attachmentNote = pendingFileChange ? 'Archivo pendiente de sincronización'
                        : !hasAttachment ? (study.viewer ? null : 'Sin archivo adjunto')
                            : isSourceUnavailable(study.driveFileId) ? 'Archivo no disponible'
                                : isOffline ? 'Conectate para abrir el archivo' : null;
                    const viewerNote = !study.viewer ? null
                        : isSourceUnavailable(study.viewer) ? 'Visor no disponible'
                            : isOffline ? 'Conectate para abrir el visor' : null;

                    return (
                        <li key={id}>
                            <span>{study.title}</span>
                            {attachmentNote && <span className="appointment-study-note">{attachmentNote}</span>}
                            {hasAttachment && !attachmentNote && (
                                <a href={reportUrl(study.driveFileId)} target="_blank" rel="noopener noreferrer"
                                   aria-label={`${studyAttachmentLabel(study)} de ${study.title}`}>
                                    {studyAttachmentLabel(study)}
                                </a>
                            )}
                            {viewerNote && <span className="appointment-study-note">{viewerNote}</span>}
                            {study.viewer && !viewerNote && (
                                <a href={study.viewer} target="_blank" rel="noopener noreferrer"
                                   aria-label={`Abrir visor de ${study.title}`}>Abrir visor</a>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
