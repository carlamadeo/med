import { useState } from 'preact/hooks';
import { driveAuth, drivePortalRepo } from '@data';
import { Outbox } from '@data/outbox';
import { normalize, viewerURL } from '@domain/utils';
import type { Portal } from '@domain/models';
import { filters, portals, studies, view } from '../state/store';

const outbox = new Outbox();

export function Portals() {
  const [editing, setEditing] = useState<Portal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const displayName = String(data.get('name') ?? '').trim();
    setBusy(true); setMessage('');
    try {
      if (!displayName) throw new Error('Ingresá un nombre para el portal.');
      const draft = { id: editing?.id, revision: editing?.revision, name: editing?.name ?? displayName, displayName, url: viewerURL(String(data.get('url') ?? '').trim()), notes: String(data.get('notes') ?? '') };
      const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
      if (draft.id && (await outbox.list(owner)).some((item) => item.portalId === draft.id)) throw new Error('Este portal ya tiene un cambio pendiente.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        await outbox.enqueuePortalSave(owner, draft);
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        setEditing(null); form.reset(); setMessage('Portal guardado en este dispositivo; se sincronizará al volver la conexión.');
        return;
      }
      const saved = await drivePortalRepo.save(draft);
      portals.value = [...portals.value.filter((p) => p.id !== saved.id), saved];
      setEditing(null); form.reset();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo guardar el portal.'); }
    finally { setBusy(false); }
  }
  async function remove(portal: Portal) {
    if (!window.confirm(`¿Eliminar el portal ${portal.displayName}?`)) return;
    setBusy(true); setMessage('');
    try {
      const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
      if ((await outbox.list(owner)).some((item) => item.portalId === portal.id)) throw new Error('Este portal ya tiene un cambio pendiente.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        await outbox.enqueuePortalDelete(owner, portal);
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        setMessage('Eliminación pendiente de sincronización.');
        return;
      }
      await drivePortalRepo.delete(portal); portals.value = portals.value.filter((p) => p.id !== portal.id);
    }
    catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo eliminar el portal.'); }
    finally { setBusy(false); }
  }
  return <section className="directory" aria-labelledby="portals-title">
    <h2 id="portals-title">Portales e instituciones</h2>
    <form id="portal-form" key={editing?.id ?? 'new'} onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
      <fieldset disabled={busy}>
        <legend>{editing ? 'Editar portal' : 'Agregar portal'}</legend>
        <label>Nombre <input id="portal-name" name="name" required maxLength={120} defaultValue={editing?.displayName ?? ''} /></label>
        <label>Enlace <input id="portal-url" name="url" type="url" defaultValue={editing?.url ?? ''} /></label>
        <label>Notas <textarea name="notes" defaultValue={editing?.notes ?? ''} /></label>
        <button type="submit" className="button primary">Guardar portal</button>
        {editing && <button type="button" onClick={() => setEditing(null)}>Cancelar</button>}
      </fieldset>
    </form>
    {message && <p role="alert">{message}</p>}
    <ul id="portals-list">{portals.value.map((portal) => {
      const count = studies.value.filter((study) => normalize(study.portal) === normalize(portal.name)).length;
      return <li key={portal.id}><h3>{portal.displayName}</h3><p>{portal.notes}</p>
        {portal.url && <a href={portal.url} target="_blank" rel="noopener noreferrer">Abrir portal</a>}
        <button type="button" onClick={() => { filters.value = { ...filters.value, portal: portal.name }; view.value = 'cronologia'; }}>Ver estudios ({count})</button>
        <button type="button" onClick={() => setEditing(portal)}>Editar</button>
        <button type="button" disabled={busy} onClick={() => void remove(portal)}>Eliminar</button>
      </li>;
    })}</ul>
  </section>;
}
