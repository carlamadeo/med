import {DriveSessionError, driveAppointmentRepo, driveAuth, googleCalendarRepo} from '@data';
import {Outbox} from '@data/outbox';
import {validateDocument} from '@data/pdf-analysis';
import {appointmentInstant, validateAppointment} from '@domain/appointments';
import {findDoctorByName, type DoctorDirectoryEntry} from '@domain/doctors';
import {cleanSpecialty, doctorNames, normalizeDoctorName} from '@domain/library';
import type {Appointment, AppointmentDraft, MedicalEvent, Operation} from '@domain/models';
import type {AutocompleteOption} from '../components/AutocompleteTextField';
import {appointments, isLocalDemo} from '../state/store';
import {enqueueOffline} from './enqueueOffline';

const outbox = new Outbox();
const demoPrescriptions = new WeakMap<Appointment, File>();

export function buildProfessionalOptions(
    directory: readonly DoctorDirectoryEntry[],
    appointmentsList: readonly Appointment[],
    medicalEventsList: readonly MedicalEvent[],
    operationsList: readonly Operation[],
): AutocompleteOption[] {
    const directoryOptions: AutocompleteOption[] = directory.map((entry) => ({
        value: entry.name,
        hint: [entry.specialty, `${entry.studyCount} ${entry.studyCount === 1 ? 'estudio' : 'estudios'}`]
            .filter(Boolean)
            .join(' · '),
    }));
    const seenKeys = new Set(directory.map((entry) => entry.key));
    const extraProfessionals = doctorNames([], [
        ...appointmentsList.map((item) => item.professional),
        ...medicalEventsList.map((item) => item.doctor),
        ...operationsList.map((item) => item.surgeon),
    ]).filter((name) => !seenKeys.has(normalizeDoctorName(name)));
    return [
        ...directoryOptions,
        ...extraProfessionals.map((name) => ({value: name})),
    ];
}

export function resolveProfessionalSpecialty(
    professionalName: string,
    directory: readonly DoctorDirectoryEntry[],
    appointmentsList: readonly Appointment[],
    medicalEventsList: readonly MedicalEvent[],
): string {
    const matched = findDoctorByName(directory, professionalName);
    if (matched?.specialty) return matched.specialty;
    const key = normalizeDoctorName(professionalName);
    if (!key) return '';
    const candidates: Array<{ date: string; specialty: string }> = [];
    for (const item of appointmentsList) {
        const specialty = cleanSpecialty(item.specialty);
        if (specialty && normalizeDoctorName(item.professional) === key) {
            candidates.push({date: item.date ?? '', specialty});
        }
    }
    for (const item of medicalEventsList) {
        const specialty = cleanSpecialty(item.specialty);
        if (specialty && normalizeDoctorName(item.doctor) === key) {
            candidates.push({date: item.date ?? '', specialty});
        }
    }
    candidates.sort((a, b) => b.date.localeCompare(a.date));
    return candidates[0]?.specialty ?? '';
}

/** Updates an auto-suggested field only if it is empty or still matches the last auto-filled value. */
export function syncAutoField(
    currentValue: string,
    suggestedValue: string,
    autoRef: { current: string | null },
    setValue: (value: string) => void,
): void {
    if (!currentValue.trim()) {
        if (suggestedValue) {
            setValue(suggestedValue);
            autoRef.current = suggestedValue;
        } else {
            autoRef.current = null;
        }
    } else if (autoRef.current !== null && currentValue === autoRef.current) {
        setValue(suggestedValue);
        autoRef.current = suggestedValue || null;
    }
}

export function getAppointmentPrescription(appointment: Appointment): Promise<File> {
    if (!isLocalDemo.value) return driveAppointmentRepo.getPrescription(appointment);
    const file = demoPrescriptions.get(appointment);
    return file ? Promise.resolve(file) : Promise.reject(new Error('La receta no está disponible.'));
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
    if (driveAuth.hasCalendarAccess()) {
        try {
            await googleCalendarRepo.syncAppointment(saved, token, {preferUpdate: Boolean(editing)});
        } catch (error) {
            if (error instanceof DriveSessionError) return {};
            return {
                appointment: saved,
                message: 'El turno se guardó en Drive, pero no se pudo sincronizar con Google Calendar. Revisá tu conexión y que Google Calendar API esté habilitada.',
            };
        }
    }
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
    if (driveAuth.hasCalendarAccess()) {
        try {
            await googleCalendarRepo.removeAppointment(driveId, token);
        } catch (error) {
            if (error instanceof DriveSessionError) return {};
            return {message: 'Turno eliminado de Drive, pero no se pudo quitar de Google Calendar.'};
        }
    }
    return {};
}

