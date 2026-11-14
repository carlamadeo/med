import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, drivePortalRepo} from '@data';
import {Outbox} from '@data/outbox';
import {normalize, viewerURL} from '@domain/utils';
import type {Portal} from '@domain/models';
import {filters, portals, studies, view} from '../state/store';
import {enqueueOffline} from '../utils/enqueueOffline';

const outbox = new Outbox();

export function Portals() {
    const [editing, setEditing] = useState<Portal | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [query, setQuery] = useState('');
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (formOpen && !dialog.open) dialog.showModal();
        if (!formOpen && dialog.open) dialog.close();
    }, [formOpen]);

    const openNew = () => {
        setEditing(null);
        setFormOpen(true);
    };

    const openEdit = (portal: Portal) => {
        setEditing(portal);
        setFormOpen(true);
    };

    const close = () => {
        setFormOpen(false);
        setEditing(null);
    };

    async function save(form: HTMLFormElement) {
        const data = new FormData(form);
        const displayName = String(data.get('name') ?? '').trim();
        setBusy(true);
        setMessage('');
        try {
            const token = await driveAuth.getAccessToken();
            if (!displayName) {
                setMessage('Ingresá un nombre para el portal.');
                setBusy(false);
                return;
            }
            const draft = {
                id: editing?.id,
                revision: editing?.revision,
                name: editing?.name ?? displayName,
                displayName,
                url: viewerURL(String(data.get('url') ?? '').trim()),
                notes: String(data.get('notes') ?? ''),
            };
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                setBusy(false);
                return;
            }
            if (draft.id && (await outbox.list(owner)).some((item) => item.portalId === draft.id)) {
                setMessage('Este portal ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    setBusy(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueuePortalSave(owner, draft), token);
                if (await driveAuth.getAccessToken() !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setEditing(null);
                form.reset();
                setFormOpen(false);
                setMessage('Portal guardado en este dispositivo; se sincronizará al volver la conexión.');
                return;
            }
            if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
            const saved = await drivePortalRepo.save(draft);
            if (await driveAuth.getAccessToken() !== token) return;
            portals.value = [...portals.value.filter((portal) => portal.id !== saved.id), saved];
            setEditing(null);
            form.reset();
            setFormOpen(false);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo guardar el portal.');
        } finally {
            setBusy(false);
        }
    }

    async function remove(portal: Portal) {
        if (!window.confirm(`¿Eliminar el portal ${portal.displayName}?`)) return;
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
            if ((await outbox.list(owner)).some((item) => item.portalId === portal.id)) {
                setMessage('Este portal ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    setBusy(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueuePortalDelete(owner, portal), token);
                if (await driveAuth.getAccessToken() !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setMessage('Eliminación pendiente de sincronización.');
                return;
            }
            if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
            await drivePortalRepo.delete(portal);
            if (await driveAuth.getAccessToken() !== token) return;
            portals.value = portals.value.filter((item) => item.id !== portal.id);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el portal.');
        } finally {
            setBusy(false);
        }
    }

    const normalizedQuery = normalize(query);
    const filtered = portals.value.filter((portal) => {
        if (!normalizedQuery) return true;
        return [portal.displayName, portal.name, portal.url, portal.notes ?? ''].some((value) => normalize(value).includes(normalizedQuery));
    });

    return (
        <section className="portals" aria-labelledby="portals-title">
            <div className="portals-head">
                <div>
                    <p className="eyebrow">Directorio</p>
                    <h2 id="portals-title">Portales e instituciones</h2>
                    <p className="portals-desc">Accesos guardados y estudios vinculados a cada institución.</p>
                </div>
                <div className="portals-head-actions">
                    <span className="count-badge">{portals.value.length}</span>
                    <button className="button primary" type="button" onClick={openNew}>
                        <svg className="icon">
                            <use href="#i-plus"/>
                        </svg>
                        Agregar portal
                    </button>
                </div>
            </div>

            <div className="portals-toolbar">
                <label className="portals-search">
                    <svg className="icon">
                        <use href="#i-search"/>
                    </svg>
                    <span className="sr-only">Buscar portales</span>
                    <input id="portal-search" type="search" placeholder="Buscar por nombre, enlace o nota…"
                           value={query} onInput={(event) => setQuery((event.target as HTMLInputElement).value)}/>
                </label>
            </div>

            {message && <p className="portals-message" role="alert">{message}</p>}

            {filtered.length ? (
                <ul id="portals-list" className="portal-grid">
                    {filtered.map((portal) => {
                        const count = studies.value.filter((study) => normalize(study.portal) === normalize(portal.name)).length;
                        const initial = Array.from(portal.displayName.trim())[0]?.toUpperCase() || 'P';
                        return (
                            <li className="portal-card" key={portal.id}>
                                <div className="portal-card-head">
                                    <span className="portal-logo" aria-hidden="true">{initial}</span>
                                    <div className="portal-card-title">
                                        <h3>{portal.displayName}</h3>
                                        <p>{portal.notes || 'Sin notas'}</p>
                                    </div>
                                </div>
                                <div className="portal-card-meta">
                                    <span className="count-badge">{count} {count === 1 ? 'estudio' : 'estudios'}</span>
                                    {portal.url && (
                                        <a className="portal-link" href={portal.url} target="_blank"
                                           rel="noopener noreferrer">
                                            Abrir portal <svg className="icon">
                                            <use href="#i-external"/>
                                        </svg>
                                        </a>
                                    )}
                                </div>
                                <div className="portal-card-actions">
                                    <button className="button secondary button-sm" type="button" onClick={() => {
                                        filters.value = {...filters.value, portal: portal.name};
                                        view.value = 'cronologia';
                                    }}>Ver estudios
                                    </button>
                                    <button className="button ghost button-sm" type="button"
                                            onClick={() => openEdit(portal)}>Editar
                                    </button>
                                    <button className="button ghost button-sm portal-delete" type="button"
                                            disabled={busy} onClick={() => void remove(portal)}>Eliminar
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <div className="portal-empty">
                    <span className="portal-empty-icon"><svg className="icon"><use href="#i-globe"/></svg></span>
                    <p>{normalizedQuery ? 'No hay portales que coincidan con la búsqueda.' : 'Todavía no hay portales guardados.'}</p>
                    {normalizedQuery ? (
                        <button className="button secondary button-sm" type="button"
                                onClick={() => setQuery('')}>Limpiar búsqueda</button>
                    ) : (
                        <button className="button secondary button-sm" type="button" onClick={openNew}>Agregar
                            portal</button>
                    )}
                </div>
            )}

            <dialog ref={dialogRef} id="portal-dialog" className="dialog portal-dialog"
                    aria-labelledby="portal-dialog-title" onClose={close}>
                <form id="portal-form" key={editing?.id ?? 'new'} onSubmit={(event) => {
                    event.preventDefault();
                    void save(event.currentTarget);
                }}>
                    <div className="dialog-heading">
                        <div>
                            <p className="eyebrow">Directorio</p>
                            <h2 id="portal-dialog-title">{editing ? 'Editar portal' : 'Agregar portal'}</h2>
                        </div>
                        <button className="icon-button" type="button" aria-label="Cerrar" onClick={close}
                                disabled={busy}>
                            <svg className="icon">
                                <use href="#i-close"/>
                            </svg>
                        </button>
                    </div>

                    <fieldset disabled={busy}>
                        <div className="portal-form-grid">
                            <label>Nombre <input id="portal-name" name="name" required maxLength={120}
                                                 defaultValue={editing?.displayName ?? ''}/></label>
                            <label>Enlace <input id="portal-url" name="url" type="url"
                                                 defaultValue={editing?.url ?? ''}/></label>
                            <label className="wide">Notas <textarea name="notes"
                                                                    defaultValue={editing?.notes ?? ''}/></label>
                        </div>
                        <div className="dialog-actions">
                            <button className="button secondary" type="button" onClick={close}
                                    disabled={busy}>Cancelar
                            </button>
                            <button className="button primary" type="submit"
                                    disabled={busy || !driveAuth.configured}>{busy ? 'Guardando…' : 'Guardar portal'}</button>
                        </div>
                    </fieldset>
                </form>
            </dialog>
        </section>
    );
}