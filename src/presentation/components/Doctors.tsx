import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, driveDoctorRepo} from '@data';
import {Outbox} from '@data/outbox';
import {
    cleanDoctorAddresses,
    cleanDoctorName,
    doctorMatchesQuery,
    type DoctorDirectoryEntry,
} from '@domain/doctors';
import {COMMON_SPECIALTIES, cleanSpecialty, normalizeDoctorName, specialtyNames} from '@domain/library';
import type {Doctor, DoctorDraft} from '@domain/models';
import {
    doctorDirectory,
    doctors,
    error,
    isLocalDemo,
    loading,
    visibleAppointments,
    visibleDoctors,
    visibleMedicalEvents,
    visibleStudies,
} from '../state/store';
import {enqueueOffline} from '../utils/enqueueOffline';
import {useFocusTrap} from '../utils/focusTrap';
import {AutocompleteTextField} from './AutocompleteTextField';
import {ConfirmActionDialog} from './ConfirmActionDialog';
import {EmptyState} from './EmptyState';

const outbox = new Outbox();

interface DoctorsProps {
    onViewStudies: (name: string) => void;
    onRetryLoad: () => void;
}

interface AddressRow {
    uid: number;
    value: string;
}

export function Doctors({onViewStudies, onRetryLoad}: DoctorsProps) {
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState<DoctorDirectoryEntry | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [pendingDelete, setPendingDelete] = useState<DoctorDirectoryEntry | null>(null);
    const [name, setName] = useState('');
    const [specialty, setSpecialty] = useState('');
    const [addressRows, setAddressRows] = useState<AddressRow[]>([]);
    const [defaultUid, setDefaultUid] = useState(0);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const nextRowUid = useRef(1);

    useFocusTrap(dialogRef, formOpen);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (formOpen && !dialog.open) dialog.showModal();
        if (!formOpen && dialog.open) dialog.close();
    }, [formOpen]);

    const openNew = () => {
        setMessage('');
        setEditing(null);
        setName('');
        setSpecialty('');
        const uid = nextRowUid.current++;
        setAddressRows([{uid, value: ''}]);
        setDefaultUid(uid);
        setFormOpen(true);
    };

    const openEdit = (entry: DoctorDirectoryEntry) => {
        setMessage('');
        setEditing(entry);
        setName(entry.name);
        setSpecialty(entry.specialty ?? '');
        if (entry.addresses.length > 0) {
            const rows = entry.addresses.map((address) => ({uid: nextRowUid.current++, value: address}));
            setAddressRows(rows);
            setDefaultUid(rows[0]!.uid);
        } else {
            const uid = nextRowUid.current++;
            setAddressRows([{uid, value: ''}]);
            setDefaultUid(uid);
        }
        setFormOpen(true);
    };

    const close = () => {
        setFormOpen(false);
        setEditing(null);
    };

    const cancelForm = () => {
        setMessage('');
        close();
    };

    const addAddressRow = () => {
        const uid = nextRowUid.current++;
        setAddressRows((prev) => [...prev, {uid, value: ''}]);
        setDefaultUid((prev) => prev || uid);
    };

    const updateAddressRow = (uid: number, value: string) => {
        setAddressRows((prev) => prev.map((row) => (row.uid === uid ? {...row, value} : row)));
    };

    const removeAddressRow = (uid: number) => {
        setAddressRows((prev) => {
            const remaining = prev.filter((row) => row.uid !== uid);
            if (defaultUid === uid) setDefaultUid(remaining[0]?.uid ?? 0);
            return remaining;
        });
    };

    async function save() {
        const cleanedName = cleanDoctorName(name);
        setBusy(true);
        setMessage('');
        try {
            if (!cleanedName) {
                setMessage('Ingresá el nombre del médico.');
                return;
            }
            const normalizedKey = normalizeDoctorName(cleanedName);
            const editingId = editing?.doctor?.id;
            if (
                visibleDoctors.value.some(
                    (doc) => doc.id !== editingId && normalizeDoctorName(doc.name) === normalizedKey,
                )
            ) {
                setMessage('Ya existe otro médico guardado con ese nombre.');
                return;
            }
            const selectedDefault = addressRows.find((row) => row.uid === defaultUid)?.value;
            const {addresses, defaultAddress} = cleanDoctorAddresses(
                addressRows.map((row) => row.value),
                selectedDefault,
            );
            const draft: DoctorDraft = {
                id: editing?.doctor?.id,
                revision: editing?.doctor?.revision,
                name: cleanedName,
                specialty: cleanSpecialty(specialty),
                addresses,
                defaultAddress,
            };
            if (isLocalDemo.value) {
                const saved: Doctor = {
                    id: draft.id || `demo-doctor-${Date.now()}`,
                    revision: '1',
                    name: draft.name,
                    specialty: draft.specialty,
                    addresses: draft.addresses,
                    defaultAddress: draft.defaultAddress,
                };
                doctors.value = [...doctors.value.filter((doc) => doc.id !== saved.id), saved];
                close();
                return;
            }
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                return;
            }
            if (draft.id && (await outbox.list(owner)).some((item) => item.doctorId === draft.id)) {
                setMessage('Este médico ya tiene un cambio pendiente.');
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueDoctorSave(owner, draft), token);
                if ((await driveAuth.getAccessToken()) !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                close();
                setMessage('Médico guardado en este dispositivo; se sincronizará al volver la conexión.');
                return;
            }
            if ((await driveAuth.getAccessToken()) !== token) {
                throw new Error('La cuenta cambió. Volvé a intentar.');
            }
            const saved = await driveDoctorRepo.save(draft);
            if ((await driveAuth.getAccessToken()) !== token) return;
            doctors.value = [...doctors.value.filter((doc) => doc.id !== saved.id), saved];
            close();
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'No se pudo guardar el médico.');
        } finally {
            setBusy(false);
        }
    }

    async function executeRemove(entry: DoctorDirectoryEntry) {
        const doc = entry.doctor;
        if (!doc) return;
        setBusy(true);
        setMessage('');
        try {
            if (isLocalDemo.value) {
                doctors.value = doctors.value.filter((item) => item.id !== doc.id);
                return;
            }
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                return;
            }
            if ((await outbox.list(owner)).some((item) => item.doctorId === doc.id)) {
                setMessage('Este médico ya tiene un cambio pendiente.');
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    return;
                }
                if (!doc.revision) {
                    setMessage('El médico no tiene una revisión válida.');
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueDoctorDelete(owner, doc.id, doc.revision!), token);
                if ((await driveAuth.getAccessToken()) !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setMessage('Eliminación pendiente de sincronización.');
                return;
            }
            if ((await driveAuth.getAccessToken()) !== token) {
                throw new Error('La cuenta cambió. Volvé a intentar.');
            }
            if (!doc.revision) {
                setMessage('El médico no tiene una revisión válida.');
                return;
            }
            await driveDoctorRepo.delete(doc.id, doc.revision);
            if ((await driveAuth.getAccessToken()) !== token) return;
            doctors.value = doctors.value.filter((item) => item.id !== doc.id);
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'No se pudo eliminar el médico.');
        } finally {
            setBusy(false);
            setPendingDelete(null);
        }
    }

    const entries = doctorDirectory.value;
    const normalizedQuery = normalizeDoctorName(query);
    const matchingDoctors = entries.filter((entry) => doctorMatchesQuery(entry, normalizedQuery));
    const availableSpecialties = specialtyNames(
        [
            ...visibleStudies.value,
            ...visibleDoctors.value,
            ...visibleAppointments.value,
            ...visibleMedicalEvents.value,
        ],
        COMMON_SPECIALTIES,
    );
    const loadError = error.value;

    return (
        <section className="portals" aria-labelledby="doctors-title">
            <div className="portals-head">
                <div>
                    <p className="eyebrow">Directorio</p>
                    <h2 id="doctors-title">Estudios por profesional</h2>
                    <p className="portals-desc">
                        Profesionales ordenados por cantidad de estudios, con su especialidad y direcciones.
                    </p>
                </div>
                <div className="portals-head-actions">
                    <span
                        className="count-badge"
                        aria-label={`${entries.length} ${entries.length === 1 ? 'profesional' : 'profesionales'}`}
                    >
                        {entries.length}
                    </span>
                    <button className="button primary" type="button" onClick={openNew}>
                        <svg className="icon" aria-hidden="true">
                            <use href="#i-plus"/>
                        </svg>
                        Agregar médico
                    </button>
                </div>
            </div>

            {!formOpen && message && (
                <p className="portals-message" role="alert">
                    {message}
                </p>
            )}

            {loading.value ? (
                <p className="list-status" role="status">
                    Cargando tus estudios…
                </p>
            ) : loadError ? (
                <EmptyState
                    variant="error"
                    title="No se pudo abrir el archivo"
                    description={loadError}
                    action={
                        <button className="button secondary" type="button" onClick={onRetryLoad}>
                            Reintentar
                        </button>
                    }
                />
            ) : entries.length === 0 ? (
                <div className="portal-empty" role="status">
                    <span className="portal-empty-icon">
                        <svg className="icon" aria-hidden="true">
                            <use href="#i-stethoscope"/>
                        </svg>
                    </span>
                    <p>
                        Agregá un médico o asigná el profesional en la ficha de un estudio para guardar su
                        especialidad y direcciones.
                    </p>
                    <button className="button secondary" type="button" onClick={openNew}>
                        Agregar médico
                    </button>
                </div>
            ) : (
                <>
                    <div className="portals-toolbar">
                        <label className="portals-search" htmlFor="doctor-search">
                            <svg className="icon" aria-hidden="true">
                                <use href="#i-search"/>
                            </svg>
                            <span className="sr-only">Buscar profesionales</span>
                            <input
                                id="doctor-search"
                                type="search"
                                placeholder="Buscar por nombre, especialidad o dirección…"
                                value={query}
                                onInput={(event) => setQuery(event.currentTarget.value)}
                            />
                        </label>
                    </div>
                    {matchingDoctors.length ? (
                        <ul id="doctors-list" className="portal-grid">
                            {matchingDoctors.map((entry) => {
                                const {key, name: docName, specialty: docSpecialty, addresses, studyCount, doctor} =
                                    entry;
                                const syncLabel =
                                    doctor?.syncStatus === 'conflict'
                                        ? 'Requiere revisión'
                                        : doctor?.syncStatus === 'failed'
                                            ? 'No se puede sincronizar'
                                            : doctor?.syncStatus === 'pending'
                                                ? 'Pendiente de sincronización'
                                                : '';
                                const syncTone =
                                    doctor?.syncStatus === 'conflict' || doctor?.syncStatus === 'failed'
                                        ? 'danger'
                                        : 'warning';
                                return (
                                    <li className="portal-card" key={doctor?.id ?? key}>
                                        <div className="portal-card-head">
                                            <span className="portal-logo" aria-hidden="true">
                                                <svg className="icon">
                                                    <use href="#i-stethoscope"/>
                                                </svg>
                                            </span>
                                            <div className="portal-card-title">
                                                <h3>{docName}</h3>
                                                {docSpecialty && <p className="doctor-card-specialty">{docSpecialty}</p>}
                                                <p>
                                                    {studyCount} {studyCount === 1 ? 'estudio' : 'estudios'}
                                                </p>
                                            </div>
                                        </div>
                                        {addresses.length > 0 && (
                                            <ul className="doctor-address-list" aria-label={`Direcciones de ${docName}`}>
                                                {addresses.map((address, index) => (
                                                    <li key={address} className="doctor-address-item">
                                                        <span>{address}</span>
                                                        {index === 0 && (
                                                            <span className="tag tag-primary">Predeterminada</span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {syncLabel && (
                                            <span className="status-pill" data-tone={syncTone}>
                                                {syncLabel}
                                            </span>
                                        )}
                                        <div className="portal-card-actions">
                                            {studyCount > 0 && (
                                                <button
                                                    className="button secondary button-sm"
                                                    type="button"
                                                    aria-label={`Ver estudios de ${docName}`}
                                                    onClick={() => onViewStudies(docName)}
                                                >
                                                    Ver estudios
                                                </button>
                                            )}
                                            <button
                                                className="button ghost button-sm"
                                                type="button"
                                                aria-label={`Editar ${docName}`}
                                                disabled={busy || Boolean(doctor?.syncStatus)}
                                                onClick={() => openEdit(entry)}
                                            >
                                                Editar
                                            </button>
                                            {doctor && (
                                                <button
                                                    className="button ghost button-sm portal-delete"
                                                    type="button"
                                                    aria-label={`Eliminar ficha de ${docName}`}
                                                    disabled={busy || Boolean(doctor.syncStatus)}
                                                    onClick={() => setPendingDelete(entry)}
                                                >
                                                    Eliminar
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="portal-empty">
                            <p role="status">No hay profesionales que coincidan con la búsqueda.</p>
                            <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>
                                Limpiar búsqueda
                            </button>
                        </div>
                    )}
                </>
            )}

            <dialog
                ref={dialogRef}
                id="doctor-dialog"
                className="dialog portal-dialog doctor-dialog"
                aria-labelledby="doctor-dialog-title"
                onCancel={(event) => {
                    event.preventDefault();
                    if (!busy) cancelForm();
                }}
                onClose={close}
            >
                {formOpen && (
                    <form
                        id="doctor-form"
                        key={editing?.doctor?.id ?? editing?.key ?? 'new'}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void save();
                        }}
                    >
                        <div className="dialog-heading">
                            <div>
                                <p className="eyebrow">Directorio</p>
                                <h2 id="doctor-dialog-title">
                                    {editing?.doctor ? 'Editar médico' : 'Agregar médico'}
                                </h2>
                            </div>
                            <button
                                className="icon-button"
                                type="button"
                                aria-label="Cerrar"
                                onClick={cancelForm}
                                disabled={busy}
                            >
                                <svg className="icon">
                                    <use href="#i-close"/>
                                </svg>
                            </button>
                        </div>

                        <fieldset disabled={busy}>
                            <div className="portal-form-grid">
                                <label htmlFor="doctor-name" className="wide">
                                    Nombre
                                    <input
                                        id="doctor-name"
                                        name="name"
                                        required
                                        maxLength={120}
                                        placeholder="Ej. Dra. Ana Pérez"
                                        value={name}
                                        onInput={(event) => setName(event.currentTarget.value)}
                                    />
                                </label>
                                <AutocompleteTextField
                                    id="doctor-specialty"
                                    name="specialty"
                                    label="Especialidad"
                                    value={specialty}
                                    onChange={setSpecialty}
                                    options={availableSpecialties}
                                    placeholder="Elegí o escribí una especialidad"
                                    listId="doctor-specialties"
                                    className="wide"
                                    disabled={busy}
                                />
                                <fieldset className="doctor-addresses-fieldset wide">
                                    <legend>
                                        Direcciones <small aria-hidden="true">Opcional</small>
                                    </legend>
                                    <div className="doctor-address-rows">
                                        {addressRows.map((row, index) => (
                                            <div className="doctor-address-row" key={row.uid}>
                                                <input
                                                    type="text"
                                                    maxLength={240}
                                                    autoComplete="street-address"
                                                    placeholder="Consultorio, clínica o dirección"
                                                    aria-label={`Dirección ${index + 1}`}
                                                    value={row.value}
                                                    onInput={(event) =>
                                                        updateAddressRow(row.uid, event.currentTarget.value)
                                                    }
                                                />
                                                <label className="doctor-default-radio">
                                                    <input
                                                        type="radio"
                                                        name="defaultAddressUid"
                                                        value={String(row.uid)}
                                                        checked={defaultUid === row.uid}
                                                        onChange={() => setDefaultUid(row.uid)}
                                                    />
                                                    <span>Predeterminada</span>
                                                </label>
                                                <button
                                                    type="button"
                                                    className="button ghost button-sm"
                                                    aria-label={`Quitar dirección ${index + 1}`}
                                                    onClick={() => removeAddressRow(row.uid)}
                                                >
                                                    Quitar
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <button type="button" className="button secondary button-sm" onClick={addAddressRow}>
                                        Agregar dirección
                                    </button>
                                </fieldset>
                            </div>
                            {message && (
                                <p className="form-error" role="alert">
                                    {message}
                                </p>
                            )}
                            <div className="dialog-actions">
                                <button className="button secondary" type="button" onClick={cancelForm} disabled={busy}>
                                    Cancelar
                                </button>
                                <button
                                    className="button primary"
                                    type="submit"
                                    disabled={busy || (!driveAuth.configured && !isLocalDemo.value)}
                                >
                                    {busy ? 'Guardando…' : 'Guardar médico'}
                                </button>
                            </div>
                        </fieldset>
                    </form>
                )}
            </dialog>

            <ConfirmActionDialog
                open={Boolean(pendingDelete)}
                title="Eliminar ficha de médico"
                message={
                    pendingDelete
                        ? pendingDelete.studyCount > 0
                            ? `¿Eliminar la ficha de ${pendingDelete.name}? Sus ${pendingDelete.studyCount} estudios seguirán en tu biblioteca.`
                            : `¿Eliminar la ficha de ${pendingDelete.name}?`
                        : ''
                }
                confirmLabel="Eliminar ficha"
                busy={busy}
                onConfirm={() => {
                    if (pendingDelete) void executeRemove(pendingDelete);
                }}
                onCancel={() => setPendingDelete(null)}
            />
        </section>
    );
}
