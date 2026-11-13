import { useState } from 'preact/hooks';
import { driveAuth, driveEpisodeRepo } from '@data';
import { Outbox } from '@data/outbox';
import type { Episode, EpisodeDraft, SymptomObservation, Medication } from '@domain/models';
import { episodes, visibleEpisodes } from '../state/store';

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

function formatDateForInput(date: Date): string {
  const iso = date.toISOString();
  const parts = iso.split('T');
  return parts[0] ?? '';
}

function createEmptyObservation(): FormObservation {
  return {
    date: formatDateForInput(new Date()),
    text: '',
    symptoms: [],
  } as FormObservation;
}

function toFormObservation(obs: SymptomObservation): FormObservation {
  return {
    date: obs.date,
    text: obs.text,
    temperature: obs.temperature,
    symptoms: obs.symptoms.map(s => ({ name: s.name, intensity: s.intensity, description: s.description })),
  };
}

function toDomainObservation(obs: FormObservation): SymptomObservation {
  return {
    date: obs.date,
    text: obs.text,
    temperature: obs.temperature,
    symptoms: obs.symptoms.map(s => ({ name: s.name, intensity: s.intensity, description: s.description })),
  };
}

function toFormMedication(med: Medication): FormMedication {
  return { name: med.name, frequency: med.frequency, instructions: med.instructions };
}

function toDomainMedication(med: FormMedication): Medication {
  return { name: med.name, frequency: med.frequency, instructions: med.instructions };
}

export function Episodes() {
  const [editing, setEditing] = useState<Episode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [observations, setObservations] = useState<FormObservation[]>([createEmptyObservation()]);
  const [medications, setMedications] = useState<FormMedication[]>([{ name: '', frequency: '', instructions: '' }]);

  function resetForm() {
    setObservations([createEmptyObservation()]);
    setMedications([{ name: '', frequency: '', instructions: '' }]);
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
    updated[obsIndex] = { ...obs, symptoms: [...obs.symptoms, { name: '', intensity: undefined, description: '' }] };
    setObservations(updated);
  }

  function removeSymptom(obsIndex: number, symptomIndex: number) {
    const updated = [...observations];
    const obs = updated[obsIndex]!;
    updated[obsIndex] = { ...obs, symptoms: obs.symptoms.filter((_, i: number) => i !== symptomIndex) };
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
    if (field === 'name') return { name: value as string, intensity: s.intensity, description: s.description };
    if (field === 'description') return { name: s.name, intensity: s.intensity, description: value as string };
    if (field === 'intensity') return { name: s.name, intensity: value as number | undefined, description: s.description };
    return s;
  });
  updated[obsIndex] = { ...obs, symptoms: nextSymptoms };
  setObservations(updated);
}

  function addMedication() {
    setMedications([...medications, { name: '', frequency: '', instructions: '' }]);
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
    if (!illness) { setMessage('Ingresá un nombre para la enfermedad.'); return; }

    const validObservations = observations.filter((o: FormObservation) => o.date || o.text || o.temperature || o.symptoms.some((s: FormSymptomEntry) => s.name || s.intensity || s.description));
    const validMedications = medications.filter((m: FormMedication) => m.name || m.frequency || m.instructions);

    const draft: EpisodeDraft = {
      illness,
      observations: validObservations.length > 0 ? validObservations.map(toDomainObservation) : undefined,
      medications: validMedications.length > 0 ? validMedications.map(toDomainMedication) : undefined,
      id: editing?.id,
      revision: editing?.revision,
    };

    setBusy(true); setMessage('');
    const token = await driveAuth.getAccessToken();
    const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    if (!owner) { setMessage('Conectate primero para verificar tu cuenta.'); setBusy(false); return; }
    if (draft.id && (await outbox.list(owner)).some((entry) => entry.episodeId === draft.id)) { setMessage('Este episodio ya tiene un cambio pendiente.'); setBusy(false); return; }
    if (!navigator.onLine) {
      if (!navigator.locks) { setMessage('Este navegador no admite la sincronización segura sin conexión.'); setBusy(false); return; }
      await outbox.enqueueEpisodeSave(owner, draft);
      window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
      setMessage('Episodio guardado en este dispositivo; queda pendiente de sincronización.');
    } else {
      const saved = await driveEpisodeRepo.save(draft);
      if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
      episodes.value = [...episodes.value.filter((episode) => episode.id !== saved.id), saved];
    }
    if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
    setEditing(null); resetForm(); form.reset();
    setBusy(false);
  }

  function startEdit(episode: Episode) {
    setEditing(episode);
    const obs = episode.observations.length > 0 ? episode.observations.map(toFormObservation) : [createEmptyObservation()];
    const meds = episode.medications.length > 0 ? episode.medications.map(toFormMedication) : [{ name: '', frequency: '', instructions: '' }];
    setObservations(obs);
    setMedications(meds);
  }

  async function deleteEpisode(episode: Episode) {
    if (!confirm(`Eliminar el episodio "${episode.illness}"?`)) return;
    const token = await driveAuth.getAccessToken();
    const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    if (!owner) { setMessage('Conectate primero para verificar tu cuenta.'); return; }
    if (!episode.revision) { setMessage('El episodio no tiene revisión válida.'); return; }
    setBusy(true);
    if (!navigator.onLine) {
      if (!navigator.locks) { setMessage('Este navegador no admite la sincronización segura sin conexión.'); setBusy(false); return; }
      await outbox.enqueueEpisodeDelete(owner, episode.id, episode.revision);
      window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
      setMessage('Eliminación guardada en este dispositivo; queda pendiente de sincronización.');
    } else {
      await driveEpisodeRepo.delete(episode.id, episode.revision);
      if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
      episodes.value = episodes.value.filter((ep) => ep.id !== episode.id);
    }
    if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
    setMessage('Episodio eliminado.');
    setBusy(false);
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

  return <section className="directory" aria-labelledby="episodes-title">
    <h2 id="episodes-title">Episodios de salud</h2>
    <form id="episode-form" key={editing?.id ?? 'new'} onSubmit={(event: Event) => { event.preventDefault(); void save(event.currentTarget as HTMLFormElement); }}>
      <fieldset disabled={busy}>
        <legend>{editing ? 'Editar episodio' : 'Nuevo episodio'}</legend>
        <label>Enfermedad <input name="illness" required defaultValue={editing?.illness ?? ''} placeholder="Ej: Gripe, Lumbalgia, Sinusitis..." /></label>
        <fieldset>
          <legend>Observaciones (días de ocurrencia)</legend>
          {observations.map((obs: FormObservation, obsIndex: number) => (
            <div key={obsIndex} className="observation-block">
              <label>Fecha <input type="date" defaultValue={obs.date} onChange={(e) => handleDateChange(obsIndex, e)} /></label>
              <label>Texto libre <textarea defaultValue={obs.text} onChange={(e) => handleTextChange(obsIndex, e)} placeholder="Síntomas, evolución, notas..." /></label>
              <label>Temperatura (°C) <input type="number" step="0.1" min="35" max="42" defaultValue={obs.temperature ?? ''} onChange={(e) => handleTempChange(obsIndex, e)} /></label>
              <fieldset>
                <legend>Síntomas con intensidad (1-5)</legend>
                {obs.symptoms.map((symptom: FormSymptomEntry, symIndex: number) => (
                  <div key={symIndex} className="symptom-row">
                    <select defaultValue={symptom.name} onChange={(e) => handleSymptomNameChange(obsIndex, symIndex, e)}>
                      <option value="">— Seleccionar o escribir —</option>
                      {COMMON_SYMPTOMS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input type="number" min="1" max="5" placeholder="Intensidad 1-5" defaultValue={symptom.intensity ?? ''} onChange={(e) => handleSymptomIntensityChange(obsIndex, symIndex, e)} />
                    <input type="text" placeholder="Descripción" defaultValue={symptom.description ?? ''} onChange={(e) => handleSymptomDescChange(obsIndex, symIndex, e)} />
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
          {medications.map((med: FormMedication, medIndex: number) => (
            <div key={medIndex} className="medication-row">
              <input type="text" placeholder="Nombre del medicamento" defaultValue={med.name} onChange={(e) => handleMedNameChange(medIndex, e)} />
              <input type="text" placeholder="Frecuencia (ej: cada 8h)" defaultValue={med.frequency} onChange={(e) => handleMedFreqChange(medIndex, e)} />
              <input type="text" placeholder="Indicaciones médicas" defaultValue={med.instructions} onChange={(e) => handleMedInstrChange(medIndex, e)} />
              {medications.length > 1 && <button type="button" onClick={() => removeMedication(medIndex)} aria-label="Quitar medicamento">×</button>}
            </div>
          ))}
          <button type="button" onClick={addMedication}>+ Medicamento</button>
        </fieldset>
        <button className="button primary" type="submit">Guardar episodio</button>
        {editing && <button type="button" onClick={() => { setEditing(null); resetForm(); }}>Cancelar edición</button>}
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
    <ul id="episodes-list">
      {[...visibleEpisodes.value].sort((a: Episode, b: Episode) => {
        const dateA = a.observations[0]?.date ?? '';
        const dateB = b.observations[0]?.date ?? '';
        return dateB.localeCompare(dateA);
      }).map((episode: Episode) => (
        <li key={episode.id}>
          <h3>{episode.illness}</h3>
          {episode.observations[0] && <p>Inicio: {episode.observations[0].date}</p>}
          <p>{episode.observations.length} día(s) de ocurrencia · {episode.medications.filter((m: Medication) => m.name).length} medicamento(s)</p>
          {episode.observations[0]?.text && <p>{episode.observations[0].text}</p>}
          {episode.syncStatus && <p>{episode.syncStatus === 'conflict' ? 'Requiere revisión' : episode.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}</p>}
          <button type="button" disabled={Boolean(episode.syncStatus)} onClick={() => startEdit(episode)}>Editar</button>
          <button type="button" onClick={() => deleteEpisode(episode)}>Eliminar</button>
        </li>
      ))}
    </ul>
  </section>;
}