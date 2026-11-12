import { useState } from 'preact/hooks';
import { driveAuth, driveOperationRepo, driveStudyRepo, DriveConflictError } from '@data';
import { Outbox } from '@data/outbox';
import { isValidDate } from '@domain/utils';
import type { Operation, OperationDraft, Study } from '@domain/models';
import { operations, studies, filters, view } from '../state/store';

const outbox = new Outbox();

export function Operations() {
  const [editing, setEditing] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const draft: OperationDraft = { name: String(data.get('name') ?? ''), date: String(data.get('date') ?? ''), surgeon: String(data.get('surgeon') ?? ''), institution: String(data.get('institution') ?? ''), type: String(data.get('type') ?? ''), notes: String(data.get('notes') ?? ''), id: editing?.id, revision: editing?.revision };
    setBusy(true); setMessage('');
    try {
      if (!draft.name.trim()) throw new Error('Ingresá un nombre para la operación.');
      if (draft.date && !isValidDate(draft.date)) throw new Error('Ingresá una fecha válida.');
      const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
      if (draft.id && (await outbox.list(owner)).some((item) => item.operationId === draft.id)) throw new Error('Esta operación ya tiene un cambio pendiente.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        await outbox.enqueueOperationSave(owner, draft);
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        setEditing(null); form.reset(); setMessage('Operación guardada en este dispositivo; se sincronizará al volver la conexión.');
        return;
      }
      const saved = await driveOperationRepo.save(draft);
      operations.value = [...operations.value.filter((op) => op.id !== saved.id), saved];
      setEditing(null); form.reset();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo guardar la operación.'); }
    finally { setBusy(false); }
  }

  async function remove(op: Operation) {
    if (studies.value.some((study) => study.operationId === op.id)) { setMessage('Desvinculá los estudios antes de eliminar esta operación.'); return; }
    if (!window.confirm(`¿Eliminar la operación ${op.name}?`)) return;
    setBusy(true); setMessage('');
    try {
      const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
      const pending = await outbox.list(owner);
      if (pending.some((item) => item.operationId === op.id)) throw new Error('Esta operación ya tiene un cambio pendiente.');
      if (pending.some((item) => item.draft?.operationId === op.id)) throw new Error('Hay un estudio pendiente vinculado a esta operación.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        await outbox.enqueueOperationDelete(owner, op.id, op.revision ?? '');
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        setMessage('Eliminación pendiente de sincronización.');
        return;
      }
      await driveOperationRepo.delete(op.id, op.revision ?? ''); operations.value = operations.value.filter((item) => item.id !== op.id);
    }
    catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo eliminar la operación.'); }
    finally { setBusy(false); }
  }

  async function setLink(study: Study, operationId: string) {
    setBusy(true); setMessage('');
    try {
      const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
      const pending = await outbox.list(owner);
      if (pending.some((item) => item.studyId === study.id)) throw new Error('Este estudio ya tiene un cambio pendiente.');
      if (operationId && pending.some((item) => item.kind === 'operation-delete' && item.operationId === operationId)) throw new Error('La operación tiene una eliminación pendiente.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        await outbox.enqueueSave(owner, { ...study, driveFileId: study.id, operationId });
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        setMessage('Vínculo pendiente de sincronización.');
        return;
      }
      const saved = await driveStudyRepo.save({ ...study, driveFileId: study.id, operationId });
      studies.value = studies.value.map((item) => item.id === saved.id ? saved : item);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo actualizar el estudio.');
      if (err instanceof DriveConflictError) {
        try { studies.value = await driveStudyRepo.list({ force: true }); }
        catch { /* Keep the displayed list if refresh also fails. */ }
      }
    } finally { setBusy(false); }
  }

  const detail = operations.value.find((op) => op.id === detailId);

  if (detail) {
    const orderedStudies = [...studies.value].sort((a, b) => b.date.localeCompare(a.date));
    return <section className="directory" id="operation-detail" aria-labelledby="operation-detail-title">
      <button type="button" onClick={() => setDetailId(null)}>Volver a operaciones</button>
      <h2 id="operation-detail-title">{detail.name}</h2>
      <p>{[detail.date, detail.surgeon, detail.institution, detail.type].filter(Boolean).join(' · ')}</p>
      {detail.notes && <p>{detail.notes}</p>}
      <h3>Estudios vinculados</h3>
      <p>Seleccioná los estudios que pertenecen a esta operación. Un estudio puede pertenecer a una sola operación.</p>
      {message && <p role="alert">{message}</p>}
      <ul>{orderedStudies.map((study) => <li key={study.id} data-linked={study.operationId === detail.id ? 'true' : 'false'}><label>
        <input type="checkbox" data-study-id={study.id} checked={study.operationId === detail.id} disabled={busy} onChange={(event) => void setLink(study, event.currentTarget.checked ? detail.id : '')} />
        {study.title} · {study.date}{study.operationId && study.operationId !== detail.id ? ' (asociado a otra operación)' : ''}
      </label></li>)}</ul>
      {!orderedStudies.length && <p>Todavía no hay estudios para vincular.</p>}
    </section>;
  }

  return <section className="directory" aria-labelledby="operations-title">
    <h2 id="operations-title">Operaciones</h2>
    <form id="operation-form" key={editing?.id ?? 'new'} onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
      <fieldset disabled={busy}>
        <legend>{editing ? 'Editar operación' : 'Agregar operación'}</legend>
        <label>Nombre <input id="operation-name" name="name" required maxLength={120} defaultValue={editing?.name ?? ''} /></label>
        <label>Fecha <input type="date" name="date" defaultValue={editing?.date ?? ''} /></label>
        <label>Cirujano <input name="surgeon" defaultValue={editing?.surgeon ?? ''} /></label>
        <label>Institución <input name="institution" defaultValue={editing?.institution ?? ''} /></label>
        <label>Intervención <input name="type" defaultValue={editing?.type ?? ''} /></label>
        <label>Notas <textarea name="notes" defaultValue={editing?.notes ?? ''} /></label>
        <button className="button primary" type="submit">Guardar operación</button>
        {editing && <button className="button quiet" type="button" onClick={() => setEditing(null)}>Cancelar</button>}
      </fieldset>
    </form>
    {message && <p role="alert">{message}</p>}
    <ul id="operations-list">
      {[...operations.value].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).map((op) => {
        const count = studies.value.filter((study) => study.operationId === op.id).length;
        return <li key={op.id}><h3>{op.name}</h3><p>{[op.date, op.surgeon, op.institution, op.type].filter(Boolean).join(' · ')}</p><p>{op.notes}</p>
          <button type="button" onClick={() => { filters.value = { ...filters.value, operationId: op.id }; view.value = 'cronologia'; }}>Ver estudios ({count})</button>
          <button type="button" data-detail onClick={() => setDetailId(op.id)}>Ficha y vínculos</button>
          <button type="button" onClick={() => setEditing(op)}>Editar</button>
          <button type="button" disabled={busy} onClick={() => void remove(op)}>Eliminar</button>
        </li>;
      })}
    </ul>
  </section>;
}
