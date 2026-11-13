import { useState } from 'preact/hooks';
import { driveAuth, driveMedicalEventRepo } from '@data';
import { Outbox } from '@data/outbox';
import { isValidDate } from '@domain/utils';
import { reportUrl } from '@domain/library';
import type { MedicalEvent, MedicalEventDraft } from '@domain/models';
import { medicalEvents, visibleMedicalEvents, studies } from '../state/store';

const outbox = new Outbox();

export function MedicalEvents() {
  const [editing, setEditing] = useState<MedicalEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const kind = String(data.get('kind'));
    if (kind !== 'consultation' && kind !== 'prescription') { setMessage('Elegí un tipo de evento válido.'); return; }
    const draft: MedicalEventDraft = {
      kind,
      date: String(data.get('date') ?? ''), doctor: String(data.get('doctor') ?? '').trim(),
      notes: String(data.get('notes') ?? '').trim(), studyIds: data.getAll('studyId').map(String),
      documentIds: data.getAll('documentId').map(String), id: editing?.id, revision: editing?.revision,
    };
    if (!isValidDate(draft.date)) { setMessage('Ingresá una fecha válida para el evento.'); return; }
    setBusy(true); setMessage('');
    const token = await driveAuth.getAccessToken();
    const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    if (!owner) { setMessage('Conectate primero para verificar tu cuenta.'); setBusy(false); return; }
    if (draft.id && (await outbox.list(owner)).some((entry) => entry.eventId === draft.id)) { setMessage('Este evento ya tiene un cambio pendiente.'); setBusy(false); return; }
    if (!navigator.onLine) {
      if (!navigator.locks) { setMessage('Este navegador no admite la sincronización segura sin conexión.'); setBusy(false); return; }
      await outbox.enqueueEventSave(owner, draft);
      window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
      setMessage('Evento guardado en este dispositivo; queda pendiente de sincronización.');
    } else {
      const saved = await driveMedicalEventRepo.save(draft);
      if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
      medicalEvents.value = [...medicalEvents.value.filter((event) => event.id !== saved.id), saved];
    }
    if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
    setEditing(null); form.reset();
    setBusy(false);
  }

  async function deleteEvent(event: MedicalEvent) {
    if (!confirm(`Eliminar la ${event.kind === 'consultation' ? 'consulta' : 'receta'} del ${event.date}?`)) return;
    try {
      const token = await driveAuth.getAccessToken();
      const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (!owner) { setMessage('Conectate primero para verificar tu cuenta.'); return; }
      if (!event.revision) { setMessage('El evento no tiene revisión válida.'); return; }
      setBusy(true);
      if (!navigator.onLine) {
        if (!navigator.locks) { setMessage('Este navegador no admite la sincronización segura sin conexión.'); setBusy(false); return; }
        await outbox.enqueueEventDelete(owner, event.id, event.revision);
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        setMessage('Eliminación guardada en este dispositivo; queda pendiente de sincronización.');
      } else {
        await driveMedicalEventRepo.delete(event.id, event.revision);
        if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
        medicalEvents.value = medicalEvents.value.filter((ev) => ev.id !== event.id);
      }
      if (await driveAuth.getAccessToken() !== token) { setBusy(false); return; }
      if (navigator.onLine) setMessage('Evento eliminado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el evento.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="directory" aria-labelledby="events-title">
    <h2 id="events-title">Consultas y recetas</h2>
    <form id="event-form" key={editing?.id ?? 'new'} onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
      <fieldset disabled={busy}>
        <legend>{editing ? 'Editar evento' : 'Agregar evento'}</legend>
        <label>Tipo <select name="kind" required defaultValue={editing?.kind ?? 'consultation'}><option value="consultation">Consulta</option><option value="prescription">Receta</option></select></label>
        <label>Fecha <input id="event-date" name="date" type="date" required defaultValue={editing?.date ?? ''} /></label>
        <label>Médico o profesional <input name="doctor" maxLength={120} defaultValue={editing?.doctor ?? ''} /></label>
        <label>Notas <textarea id="event-notes" name="notes" defaultValue={editing?.notes ?? ''} /></label>
        <fieldset><legend>Estudios relacionados</legend>{studies.value.map((study) => <label key={study.id}>
          <input type="checkbox" name="studyId" data-event-study={study.id} value={study.id} defaultChecked={editing?.studyIds.includes(study.id)} />{study.title} · {study.date}
        </label>)}{editing?.studyIds.filter((id) => !studies.value.some((study) => study.id === id)).map((id) => <label key={id}>
          <input type="checkbox" name="studyId" value={id} defaultChecked /> Estudio no disponible
        </label>)}</fieldset>
        <fieldset><legend>Documentos relacionados</legend>{studies.value.filter((study) => study.hasPdf).map((study) => <label key={study.id}>
          <input type="checkbox" name="documentId" value={study.id} defaultChecked={editing?.documentIds.includes(study.id)} />{study.reportName || study.title}
        </label>)}{editing?.documentIds.filter((id) => !studies.value.some((study) => study.id === id && study.hasPdf)).map((id) => <label key={id}>
          <input type="checkbox" name="documentId" value={id} defaultChecked /> Documento no disponible
        </label>)}</fieldset>
        <button className="button primary" type="submit">Guardar evento</button>
        {editing && <button type="button" onClick={() => setEditing(null)}>Cancelar edición</button>}
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
    <ul id="events-list">{[...visibleMedicalEvents.value].sort((a, b) => b.date.localeCompare(a.date)).map((event) => <li key={event.id}>
      <h3>{event.kind === 'consultation' ? 'Consulta' : 'Receta'} · {event.date}</h3>
      {event.doctor && <p>{event.doctor}</p>}{event.notes && <p>{event.notes}</p>}
      <p>{event.studyIds.length} estudios · {event.documentIds.length} documentos</p>
      {event.studyIds.length > 0 && <ul aria-label="Estudios relacionados">{event.studyIds.map((id) => {
        const study = studies.value.find((item) => item.id === id);
        return <li key={id}>{study ? `${study.title} · ${study.date}` : 'Estudio no disponible'}</li>;
      })}</ul>}
      {event.documentIds.length > 0 && <ul aria-label="Documentos relacionados">{event.documentIds.map((id) => {
        const source = studies.value.find((item) => item.id === id && item.hasPdf);
        return <li key={id}>{source ? <a href={reportUrl(id)} target="_blank" rel="noopener noreferrer">{source.reportName || source.title}</a> : 'Documento no disponible'}</li>;
      })}</ul>}
      {event.syncStatus && <p>{event.syncStatus === 'conflict' ? 'Requiere revisión' : event.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}</p>}
      <button type="button" disabled={Boolean(event.syncStatus)} onClick={() => setEditing(event)}>Editar</button>
      <button type="button" disabled={Boolean(event.syncStatus)} onClick={() => deleteEvent(event)}>Eliminar</button>
    </li>)}</ul>
  </section>;
}
