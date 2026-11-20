import {driveAppointmentRepo, driveAuth} from '@data';
import {Outbox} from '@data/outbox';
import {validateDocument} from '@data/pdf-analysis';
import {appointmentInstant, validateAppointment} from '@domain/appointments';
import {cleanSpecialty} from '@domain/library';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {appointments, isLocalDemo} from '../state/store';
import {enqueueOffline} from './enqueueOffline';

const outbox = new Outbox();
const demoPrescriptions = new WeakMap<Appointment, File>();

export function getAppointmentPrescription(appointment: Appointment): Promise<File> {
    if (!isLocalDemo.value) return driveAppointmentRepo.getPrescription(appointment);
    const file = demoPrescriptions.get(appointment);
    return file ? Promise.resolve(file) : Promise.reject(new Error('La receta no está disponible.'));
}

export const TIMEZONE_OPTIONS: Array<{value: string; label: string}> = [
    {value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)'},
    {value: 'America/Argentina/Cordoba', label: 'Córdoba (GMT-3)'},
    {value: 'America/Argentina/Mendoza', label: 'Mendoza (GMT-3)'},
    {value: 'America/Montevideo', label: 'Montevideo (GMT-3)'},
    {value: 'America/Santiago', label: 'Santiago (GMT-3)'},
    {value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)'},
    {value: 'America/Bogota', label: 'Bogotá (GMT-5)'},
    {value: 'America/Lima', label: 'Lima (GMT-5)'},
    {value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)'},
    {value: 'America/New_York', label: 'Nueva York (GMT-5)'},
    {value: 'Europe/Madrid', label: 'Madrid (GMT+1)'},
    {value: 'UTC', label: 'UTC'},
];

export function getTimeZoneOptions(defaultTimeZone: string): Array<{value: string; label: string}> {
    return TIMEZONE_OPTIONS.some((option) => option.value === defaultTimeZone)
        ? TIMEZONE_OPTIONS
        : [{value: defaultTimeZone, label: defaultTimeZone}, ...TIMEZONE_OPTIONS];
}

interface AppointmentSaveResult {
    appointment?: Appointment;
    message?: string;
    error?: string;
}

interface AppointmentDeleteResult {
    message?: string;
    error?: string;
}

export async function saveAppointment(draft: AppointmentDraft, editing: Appointment | null): Promise<AppointmentSaveResult> {
    const validation = validateAppointment(draft);
    if (validation.length) return {error: validation[0]!};
    if (!appointmentInstant(draft)) return {error: 'La hora elegida no existe en esa zona horaria.'};

    if (isLocalDemo.value) {
        const {prescriptionFile, removePrescription, ...fields} = draft;
        const existing = appointments.value.find(item => item.id === draft.id);
        const previous = existing && !removePrescription ? demoPrescriptions.get(existing) : undefined;
        const file = prescriptionFile ?? previous;
        const mimeType = prescriptionFile ? await validateDocument(prescriptionFile) : existing?.prescription?.mimeType;
        if (!isLocalDemo.value || (existing && !appointments.value.includes(existing))) return {};
        const saved: Appointment = {
            ...fields,
            specialty: cleanSpecialty(draft.specialty),
            id: draft.id ?? `demo-appointment-${Date.now()}`,
            revision: '1',
            prescription: file && mimeType ? {name: file.name, mimeType} : undefined,
        };
        if (file && mimeType) demoPrescriptions.set(saved, new File([file], file.name, {type: mimeType}));
        appointments.value = [...appointments.value.filter((item) => item.id !== saved.id), saved];
        return {appointment: saved};
    }

    const token = await driveAuth.getAccessToken();
    if (!token) return {error: 'Conectate primero para guardar un turno.'};
    const accountId = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    if (!accountId) return {error: 'Conectate primero para verificar tu cuenta.'};

    if (!navigator.onLine) {
        if (!navigator.locks) return {error: 'Este navegador no admite la sincronización segura de cambios sin conexión.'};
        if (draft.prescriptionFile) await validateDocument(draft.prescriptionFile);
        await enqueueOffline(accountId, () => outbox.enqueueAppointmentSave(accountId, draft), token);
        if (await driveAuth.getAccessToken() !== token) {
            return {message: 'La cuenta cambió mientras se guardaba. El turno quedó retenido con la cuenta anterior.'};
        }
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        return {message: editing ? 'Cambios guardados en este dispositivo, pendientes de sincronización.' : 'Turno guardado en este dispositivo, pendiente de sincronización.'};
    }

    if (draft.id) {
        const entries = await outbox.list(accountId);
        const pending = entries.find((entry) => entry.appointmentId === draft.id);
        if (pending) return {error: pending.lastError || 'Este turno ya tiene un cambio pendiente. Sincronizalo o descartalo antes de editarlo.'};
    }

    if (await driveAuth.getAccessToken() !== token) return {error: 'La cuenta cambió. Volvé a intentar.'};

    const saved = await driveAppointmentRepo.save(draft, token);
    if (await driveAuth.getAccessToken() !== token) return {};
    appointments.value = [...appointments.value.filter((item) => item.id !== saved.id), saved];
    return {appointment: saved};
}

export async function deleteAppointment(appointment: Appointment): Promise<AppointmentDeleteResult> {
    if (isLocalDemo.value) {
        appointments.value = appointments.value.filter((item) => item.id !== appointment.id);
        return {};
    }
    if (!appointment.revision) return {error: 'No se encontró el turno remoto.'};
    const token = await driveAuth.getAccessToken();
    if (!token) return {error: 'Conectate primero para borrar un turno.'};
    const accountId = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    if (!accountId) return {error: 'Conectate primero para verificar tu cuenta.'};

    if (!navigator.onLine) {
        if (!navigator.locks) return {error: 'Este navegador no admite la sincronización segura de cambios sin conexión.'};
        await enqueueOffline(accountId, () => outbox.enqueueAppointmentDelete(accountId, appointment.id, appointment.revision), token);
        if (await driveAuth.getAccessToken() !== token) {
            return {message: 'La cuenta cambió mientras se borraba. El turno quedó retenido con la cuenta anterior.'};
        }
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        return {message: 'Turno borrado en este dispositivo, pendiente de sincronización.'};
    }

    const entries = await outbox.list(accountId);
    const pendingSave = entries.find((entry) => entry.appointmentId === appointment.id);
    if (pendingSave) return {error: pendingSave.lastError || 'Este turno tiene un cambio pendiente. Sincronizalo o descartalo antes de borrarlo.'};

    if (await driveAuth.getAccessToken() !== token) return {error: 'La cuenta cambió. Volvé a intentar.'};
    const driveId = appointment.id;
    await driveAppointmentRepo.delete(appointment.id, appointment.revision);
    if (await driveAuth.getAccessToken() !== token) return {};
    appointments.value = appointments.value.filter((item) => item.id !== driveId);
    return {};
}

