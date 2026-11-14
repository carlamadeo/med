import {enqueueOffline} from '../utils/enqueueOffline';
import { useEffect, useRef, useState } from 'preact/hooks';
import {driveAuth, driveEpisodeRepo} from '@data';
import {Outbox} from '@data/outbox';
import {normalize, todayLocal} from '@domain/utils';
import type {Episode, EpisodeDraft, SymptomObservation, Medication} from '@domain/models';
import {episodes, visibleEpisodes} from '../state/store';

const outbox = new Outbox();

const COMMON_SYMPTOMS = ['dolor de panza', 'fiebre', 'dolor de cuerpo', 'dolor de cabeza'];

interface FormObservation {
    date: string;
    text: string;
    temperature?: number;
    symptoms: FormSymptomEntry[];
}

interface FormSymptomEntry {
    name: string;
    intensity?: number;
    description?: string;
}

interface FormMedication {
    name: string;
    frequency?: string;
    instructions?: string;
}

function createEmptyObservation(): FormObservation {
    return {
        date: todayLocal(),
        text: '',
        symptoms: [],
    } as FormObservation;
}

function toFormObservation(obs: SymptomObservation): FormObservation {
    return {
        date: obs.date,
        text: obs.text,
        temperature: obs.temperature,
        symptoms: obs.symptoms.map(s => ({name: s.name, intensity: s.intensity, description: s.description})),
    };
}

function toDomainObservation(obs: FormObservation): SymptomObservation {
    return {
        date: obs.date,
        text: obs.text,
        temperature: obs.temperature,
        symptoms: obs.symptoms.map(s => ({name: s.name, intensity: s.intensity, description: s.description})),
    };
}

function toFormMedication(med: Medication): FormMedication {
    return {name: med.name, frequency: med.frequency, instructions: med.instructions};
}

function toDomainMedication(med: FormMedication): Medication {
    return {name: med.name, frequency: med.frequency, instructions: med.instructions};
}

export function Episodes() {
    const [editing, setEditing] = useState<Episode | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [observations, setObservations] = useState<FormObservation[]>([createEmptyObservation()]);
    const [medications, setMedications] = useState<FormMedication[]>([{name: '', frequency: '', instructions: ''}]);
    const [formOpen, setFormOpen] = useState(false);
    const [query, setQuery] = useState('');
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (formOpen && !dialog.open) dialog.showModal();
        if (!formOpen && dialog.open) dialog.close();
    }, [formOpen]);

    function openNew() {
        setEditing(null);
        resetForm();
        setFormOpen(true);
    }

    function closeForm() {
        setFormOpen(false);
        setEditing(null);
        resetForm();
    }
    const illnessCounts = new Map<string, number>();
    const medicationNames = new Map<string, string>();
    for (const episode of visibleEpisodes.value) {
        if (episode.illness) illnessCounts.set(episode.illness, (illnessCounts.get(episode.illness) ?? 0) + 1);
        for (const medication of episode.medications) {
            const name = medication.name.trim();
            if (name && !medicationNames.has(name.toLocaleLowerCase('es'))) medicationNames.set(name.toLocaleLowerCase('es'), name);
        }
    }

    function resetForm() {
        setObservations([createEmptyObservation()]);
        setMedications([{name: '', frequency: '', instructions: ''}]);
    }

    function addObservation() {
        setObservations([...observations, createEmptyObservation()]);
    }

    function removeObservation(index: number) {
        if (observations.length <= 1) return;
        setObservations(observations.filter((_, i: number) => i !== index));
    }

    /* eslint-disable no-redeclare */
    function updateObservation(index: number, field: 'date', value: string): void;
    function updateObservation(index: number, field: 'text', value: string): void;
    function updateObservation(index: number, field: 'temperature', value: number | undefined): void;
    function updateObservation(index: number, field: 'symptoms', value: FormSymptomEntry[]): void;
    function updateObservation(index: number, field: keyof FormObservation, value: string | number | FormSymptomEntry[] | undefined) {
        /* eslint-enable no-redeclare */
        const updated = [...observations];
        const current = updated[index]!;
        updated[index] = {
            date: field === 'date' ? (value as string) : current.date,
            text: field === 'text' ? (value as string) : current.text,
            temperature: field === 'temperature' ? (value as number | undefined) : current.temperature,
            symptoms: field === 'symptoms' ? (value as FormSymptomEntry[]) : current.symptoms,
        };
        setObservations(updated);
    }

    function addSymptom(obsIndex: number) {
        const updated = [...observations];
        const obs = updated[obsIndex]!;
        updated[obsIndex] = {...obs, symptoms: [...obs.symptoms, {name: '', intensity: undefined, description: ''}]};
        setObservations(updated);
    }

    function removeSymptom(obsIndex: number, symptomIndex: number) {
        const updated = [...observations];
        const obs = updated[obsIndex]!;
        updated[obsIndex] = {...obs, symptoms: obs.symptoms.filter((_, i: number) => i !== symptomIndex)};
        setObservations(updated);
    }

    /* eslint-disable no-redeclare */
    function updateSymptom(obsIndex: number, symptomIndex: number, field: 'name', value: string): void;
    function updateSymptom(obsIndex: number, symptomIndex: number, field: 'description', value: string): void;
    function updateSymptom(obsIndex: number, symptomIndex: number, field: 'intensity', value: number | undefined): void;
    function updateSymptom(obsIndex: number, symptomIndex: number, field: keyof FormSymptomEntry, value: string | number | undefined) {
        /* eslint-enable no-redeclare */
        const updated = [...observations];
        const obs = updated[obsIndex]!;
        const nextSymptoms: FormSymptomEntry[] = obs.symptoms.map((s: FormSymptomEntry, i: number) => {
            if (i !== symptomIndex) return s;
            if (field === 'name') return {name: value as string, intensity: s.intensity, description: s.description};
            if (field === 'description') return {name: s.name, intensity: s.intensity, description: value as string};
            if (field === 'intensity') return {
                name: s.name,
                intensity: value as number | undefined,
                description: s.description
            };
            return s;
        });
        updated[obsIndex] = {...obs, symptoms: nextSymptoms};
        setObservations(updated);
    }

    function addMedication() {
        setMedications([...medications, {name: '', frequency: '', instructions: ''}]);
    }

    function removeMedication(index: number) {
        if (medications.length <= 1) {
            const first = medications[0];
            if (first && first.name === '') return;
        }
        setMedications(medications.filter((_, i: number) => i !== index));
    }

    function updateMedication(index: number, field: 'name' | 'frequency' | 'instructions', value: string) {
        const updated = [...medications];
        const current = updated[index]!;
        updated[index] = {
            name: field === 'name' ? value : current.name,
            frequency: field === 'frequency' ? value : current.frequency,
            instructions: field === 'instructions' ? value : current.instructions,
        };
        setMedications(updated);
    }

    async function save(form: HTMLFormElement) {
        const data = new FormData(form);
        const illness = String(data.get('illness') ?? '').trim();

        const validObservations = observations.filter((o: FormObservation) => o.date || o.text || o.temperature || o.symptoms.some((s: FormSymptomEntry) => s.name || s.intensity || s.description));
        const validMedications = medications.filter((m: FormMedication) => m.name || m.frequency || m.instructions);

        const draft: EpisodeDraft = {
            illness,
            observations: validObservations.length > 0 ? validObservations.map(toDomainObservation) : undefined,
            medications: validMedications.length > 0 ? validMedications.map(toDomainMedication) : undefined,
            closed: data.has('closed'),
            id: editing?.id,
            revision: editing?.revision,
        };

        setBusy(true);
        setMessage('');
        try {
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                setBusy(false);
                return;
            }
            if (draft.id && (await outbox.list(owner)).some((entry) => entry.episodeId === draft.id)) {
                setMessage('Este episodio ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    setBusy(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueEpisodeSave(owner, draft), token);
                if (await driveAuth.getAccessToken() !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setMessage('Episodio guardado en este dispositivo; queda pendiente de sincronización.');
            } else {
                if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                const saved = await driveEpisodeRepo.save(draft);
                if (await driveAuth.getAccessToken() !== token) {
                    setBusy(false);
                    return;
                }
                episodes.value = [...episodes.value.filter((episode) => episode.id !== saved.id), saved];
            }
            if (await driveAuth.getAccessToken() !== token) {
                setBusy(false);
                return;
            }
            setEditing(null);
            resetForm();
            form.reset();
            setFormOpen(false);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo guardar el episodio.');
        } finally {
            setBusy(false);
        }
    }

    function startEdit(episode: Episode) {
        setEditing(episode);
        const obs = episode.observations.length > 0 ? episode.observations.map(toFormObservation) : [createEmptyObservation()];
        const meds = episode.medications.length > 0 ? episode.medications.map(toFormMedication) : [{
            name: '',
            frequency: '',
            instructions: ''
        }];
        setObservations(obs);
        setMedications(meds);
        setFormOpen(true);
    }

    async function deleteEpisode(episode: Episode) {
        if (!confirm(`Eliminar el episodio "${episode.illness}"?`)) return;
        try {
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                return;
            }
            if (!episode.revision) {
                setMessage('El episodio no tiene revisión válida.');
                return;
            }
            setBusy(true);
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    setBusy(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueEpisodeDelete(owner, episode.id, episode.revision), token);
                if (await driveAuth.getAccessToken() !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setMessage('Eliminación guardada en este dispositivo; queda pendiente de sincronización.');
            } else {
                if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                await driveEpisodeRepo.delete(episode.id, episode.revision);
                if (await driveAuth.getAccessToken() !== token) {
                    setBusy(false);
                    return;
                }
                episodes.value = episodes.value.filter((ep) => ep.id !== episode.id);
            }
            if (await driveAuth.getAccessToken() !== token) {
                setBusy(false);
                return;
            }
            if (navigator.onLine) setMessage('Episodio eliminado.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el episodio.');
        } finally {
            setBusy(false);
        }
    }

    function handleDateChange(obsIndex: number, e: Event) {
        updateObservation(obsIndex, 'date', (e.currentTarget as HTMLInputElement).value);
    }

    function handleTextChange(obsIndex: number, e: Event) {
        updateObservation(obsIndex, 'text', (e.currentTarget as HTMLTextAreaElement).value);
    }

    function handleTempChange(obsIndex: number, e: Event) {
        const value = (e.currentTarget as HTMLInputElement).value;
        updateObservation(obsIndex, 'temperature', value ? parseFloat(value) : undefined);
    }

    function handleSymptomNameChange(obsIndex: number, symIndex: number, e: Event) {
        updateSymptom(obsIndex, symIndex, 'name', (e.currentTarget as HTMLSelectElement).value);
    }

    function handleSymptomIntensityChange(obsIndex: number, symIndex: number, e: Event) {
        const value = (e.currentTarget as HTMLInputElement).value;
        updateSymptom(obsIndex, symIndex, 'intensity', value ? parseInt(value, 10) : undefined);
    }

    function handleSymptomDescChange(obsIndex: number, symIndex: number, e: Event) {
        updateSymptom(obsIndex, symIndex, 'description', (e.currentTarget as HTMLInputElement).value);
    }

    function handleMedNameChange(medIndex: number, e: Event) {
        updateMedication(medIndex, 'name', (e.currentTarget as HTMLInputElement).value);
    }

    function handleMedFreqChange(medIndex: number, e: Event) {
        updateMedication(medIndex, 'frequency', (e.currentTarget as HTMLInputElement).value);
    }

    function handleMedInstrChange(medIndex: number, e: Event) {
        updateMedication(medIndex, 'instructions', (e.currentTarget as HTMLInputElement).value);
    }

    const normalizedQuery = normalize(query);
    const latestDate = (episode: Episode) => episode.observations.map((item) => item.date).sort().at(-1) ?? '';
    const visible = [...visibleEpisodes.value]
        .filter((episode) => {
            if (!normalizedQuery) return true;
            const fields = [
                episode.illness,
                ...episode.observations.flatMap((observation) => [
                    observation.date, observation.text, observation.temperature?.toString() ?? '',
                    ...observation.symptoms.flatMap((symptom) => [symptom.name, symptom.description, symptom.intensity?.toString() ?? '']),
                ]),
                ...episode.medications.flatMap((medication) => [medication.name, medication.frequency, medication.instructions]),
            ];
            return fields.some((value) => normalize(value ?? '').includes(normalizedQuery));
        })
        .sort((a, b) => latestDate(b).localeCompare(latestDate(a)));

    return <section className="episodes" aria-labelledby="episodes-title">
        <div className="episodes-head">
            <div>
                <p className="eyebrow">Seguimiento</p>
                <h2 id="episodes-title">Episodios de salud</h2>
                <p className="episodes-desc">Enfermedades, días de ocurrencia, síntomas y medicación.</p>
            </div>
            <div className="episodes-head-actions">
                <span className="count-badge">{visibleEpisodes.value.length}</span>
                <button className="button primary" type="button" onClick={openNew}>
                    <svg className="icon"><use href="#i-plus" /></svg> Nuevo episodio
                </button>
            </div>
        </div>

        <div className="episodes-toolbar">
            <label className="episodes-search">
                <svg className="icon"><use href="#i-search" /></svg>
                <span className="sr-only">Buscar episodios</span>
                <input id="episode-search" type="search" placeholder="Buscar por enfermedad, síntoma o medicamento…" value={query}
                       onInput={(event) => setQuery((event.target as HTMLInputElement).value)} />
            </label>
        </div>

        {message && <p className="episodes-message" role="status">{message}</p>}

        {illnessCounts.size > 0 && (
            <div className="episode-chips" aria-label="Episodios por enfermedad">
                {[...illnessCounts].map(([illness, count]) => <span className="episode-chip" key={illness}>
                    {illness} · {count} {count === 1 ? 'episodio' : 'episodios'}
                </span>)}
            </div>
        )}

        {visible.length ? (
            <ul id="episodes-list" className="episode-list">
                {visible.map((episode) => {
                    const observations = [...episode.observations].sort((a, b) => a.date.localeCompare(b.date));
                    const dates = observations.map((item) => item.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
                    const duration = dates.length ? Math.round((Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86400000) + 1 : null;
                    const activeMeds = episode.medications.filter((medication) => medication.name);
                    const syncLabel = episode.syncStatus === 'conflict' ? 'Requiere revisión'
                        : episode.syncStatus === 'failed' ? 'No se puede sincronizar'
                            : episode.syncStatus === 'pending' ? 'Pendiente de sincronización' : '';
                    const syncTone = episode.syncStatus === 'conflict' || episode.syncStatus === 'failed' ? 'danger' : 'warning';
                    return <li className="episode-card" key={episode.id}>
                        <div className="episode-top">
                            <div className="episode-title">
                                <h3>{episode.illness || 'Episodio de salud'}</h3>
                                <p>{episode.closed ? 'Finalizado' : 'En curso'}{duration !== null ? ` · ${duration} ${duration === 1 ? 'día' : 'días'}` : ''}</p>
                            </div>
                            {syncLabel && <span className="status-pill" data-tone={syncTone}>{syncLabel}</span>}
                        </div>

                        <div className="episode-stats">
                            <span>{observations.length} {observations.length === 1 ? 'día' : 'días'}</span>
                            <span>{activeMeds.length} {activeMeds.length === 1 ? 'medicamento' : 'medicamentos'}</span>
                        </div>

                        {observations.length > 0 && (
                            <div className="episode-observations">
                                {observations.map((observation, index) => (
                                    <div className="episode-observation" key={`${observation.date}-${index}`}>
                                        <time dateTime={observation.date}>{observation.date}</time>
                                        <p>{observation.text || 'Sin notas'}</p>
                                        <div className="episode-symptoms">
                                            {observation.temperature !== undefined && <span className="episode-symptom">Temp. {observation.temperature} °C</span>}
                                            {observation.symptoms.map((symptom, symptomIndex) => <span className="episode-symptom" key={symptomIndex}>
                                                {symptom.name}{symptom.intensity !== undefined ? ` ${symptom.intensity}/5` : ''}{symptom.description ? ` · ${symptom.description}` : ''}
                                            </span>)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeMeds.length > 0 && (
                            <div className="episode-meds">
                                {activeMeds.map((medication, index) => <span className="episode-med" key={`${medication.name}-${index}`}>
                                    <svg className="icon"><use href="#i-message" /></svg>
                                    {medication.name}{medication.frequency ? ` · ${medication.frequency}` : ''}
                                </span>)}
                            </div>
                        )}

                        <div className="episode-foot">
                            <span className="count-badge">{episode.observations.length} observaciones</span>
                            <div className="episode-actions">
                                <button className="button ghost button-sm" type="button" disabled={Boolean(episode.syncStatus)} onClick={() => startEdit(episode)}>Editar</button>
                                <button className="button ghost button-sm episode-delete" type="button" disabled={Boolean(episode.syncStatus)} onClick={() => void deleteEpisode(episode)}>Eliminar</button>
                            </div>
                        </div>
                    </li>;
                })}
            </ul>
        ) : (
            <div className="episode-empty">
                <span className="episode-empty-icon"><svg className="icon"><use href="#i-activity" /></svg></span>
                <p>{normalizedQuery ? 'No hay episodios que coincidan con la búsqueda.' : 'Todavía no hay episodios guardados.'}</p>
                {normalizedQuery ? (
                    <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>Limpiar búsqueda</button>
                ) : (
                    <button className="button secondary button-sm" type="button" onClick={openNew}>Nuevo episodio</button>
                )}
            </div>
        )}

        <dialog ref={dialogRef} id="episode-dialog" className="dialog episode-dialog" aria-labelledby="episode-dialog-title" onClose={closeForm}>
            <form id="episode-form" key={editing?.id ?? 'new'} onSubmit={(event: Event) => {
                event.preventDefault();
                void save(event.currentTarget as HTMLFormElement);
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Seguimiento</p>
                        <h2 id="episode-dialog-title">{editing ? 'Editar episodio' : 'Nuevo episodio'}</h2>
                    </div>
                    <button className="icon-button" type="button" aria-label="Cerrar" onClick={closeForm} disabled={busy}>
                        <svg className="icon"><use href="#i-close" /></svg>
                    </button>
                </div>

                <fieldset disabled={busy}>
                    <label>Enfermedad <input name="illness" defaultValue={editing?.illness ?? ''} placeholder="Ej: Gripe, Lumbalgia, Sinusitis..."/></label>
                    <label className="episode-check"><input name="closed" type="checkbox" defaultChecked={editing?.closed ?? false}/> Episodio finalizado</label>

                    <fieldset>
                        <legend>Observaciones (días de ocurrencia)</legend>
                        {observations.map((obs: FormObservation, obsIndex: number) => (
                            <div key={obsIndex} className="observation-block">
                                <label>Fecha <input type="date" defaultValue={obs.date} onChange={(e) => handleDateChange(obsIndex, e)}/></label>
                                <label>Texto libre <textarea defaultValue={obs.text} onChange={(e) => handleTextChange(obsIndex, e)} placeholder="Síntomas, evolución, notas..."/></label>
                                <label>Temperatura (°C) <input type="number" step="0.1" min="35" max="42" defaultValue={obs.temperature ?? ''} onChange={(e) => handleTempChange(obsIndex, e)}/></label>
                                <fieldset>
                                    <legend>Síntomas con intensidad (1-5)</legend>
                                    {obs.symptoms.map((symptom: FormSymptomEntry, symIndex: number) => (
                                        <div key={symIndex} className="symptom-row">
                                            <select defaultValue={symptom.name} onChange={(e) => handleSymptomNameChange(obsIndex, symIndex, e)}>
                                                <option value="">— Seleccionar o escribir —</option>
                                                {COMMON_SYMPTOMS.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                            <input type="number" min="1" max="5" placeholder="Intensidad 1-5" defaultValue={symptom.intensity ?? ''} onChange={(e) => handleSymptomIntensityChange(obsIndex, symIndex, e)}/>
                                            <input type="text" placeholder="Descripción" defaultValue={symptom.description ?? ''} onChange={(e) => handleSymptomDescChange(obsIndex, symIndex, e)}/>
                                            {obs.symptoms.length > 1 && <button type="button" onClick={() => removeSymptom(obsIndex, symIndex)} aria-label="Quitar síntoma">×</button>}
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => addSymptom(obsIndex)}>+ Síntoma</button>
                                </fieldset>
                                {observations.length > 1 && <button type="button" onClick={() => removeObservation(obsIndex)} aria-label="Quitar observación">Quitar esta observación</button>}
                            </div>
                        ))}
                        <button type="button" onClick={addObservation}>+ Agregar día de ocurrencia</button>
                    </fieldset>

                    <fieldset>
                        <legend>Medicamentos e indicaciones</legend>
                        <datalist id="episode-medications">{[...medicationNames.values()].map(name => <option key={name} value={name}/>)}</datalist>
                        {medications.map((med: FormMedication, medIndex: number) => (
                            <div key={medIndex} className="medication-row">
                                <input type="text" list="episode-medications" placeholder="Nombre del medicamento" defaultValue={med.name} onChange={(e) => handleMedNameChange(medIndex, e)}/>
                                <input type="text" placeholder="Frecuencia (ej: cada 8h)" defaultValue={med.frequency} onChange={(e) => handleMedFreqChange(medIndex, e)}/>
                                <input type="text" placeholder="Indicaciones médicas" defaultValue={med.instructions} onChange={(e) => handleMedInstrChange(medIndex, e)}/>
                                {medications.length > 1 && <button type="button" onClick={() => removeMedication(medIndex)} aria-label="Quitar medicamento">×</button>}
                            </div>
                        ))}
                        <button type="button" onClick={addMedication}>+ Medicamento</button>
                    </fieldset>

                    <div className="dialog-actions">
                        <button className="button secondary" type="button" onClick={closeForm} disabled={busy}>Cancelar</button>
                        <button className="button primary" type="submit" disabled={busy || !driveAuth.configured}>{busy ? 'Guardando…' : 'Guardar episodio'}</button>
                    </div>
                </fieldset>
            </form>
        </dialog>
    </section>;
}
