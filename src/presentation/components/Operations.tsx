import { useState } from 'preact/hooks';
import { driveOperationRepo } from '@data';
import type { Operation, OperationDraft } from '@domain/models';
import { operations, studies, filters, view } from '../state/store';

export function Operations() {
  const [editing, setEditing] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const draft: OperationDraft = { name: String(data.get('name') ?? ''), date: String(data.get('date') ?? ''), surgeon: String(data.get('surgeon') ?? ''), institution: String(data.get('institution') ?? ''), type: String(data.get('type') ?? ''), notes: String(data.get('notes') ?? ''), id: editing?.id, revision: editing?.revision };
    setBusy(true); setMessage('');
    try {
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
    try { await driveOperationRepo.delete(op.id); operations.value = operations.value.filter((item) => item.id !== op.id); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo eliminar la operación.'); }
    finally { setBusy(false); }
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
          <button type="button" onClick={() => setEditing(op)}>Editar</button>
          <button type="button" disabled={busy} onClick={() => void remove(op)}>Eliminar</button>
        </li>;
      })}
    </ul>
  </section>;
}
