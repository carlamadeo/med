import {DEFAULT_APPOINTMENT_TIME_ZONE, appointmentInstant} from '@domain/appointments';
import type {ExtractedFields} from '@domain/extract';
import type {AppointmentDraft, StudyDraft} from '@domain/models';
import {isValidDate, normalize, viewerURL} from '@domain/utils';

export type DocumentRef = {id: string; name: string};
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
type StudyFields = Pick<StudyDraft, 'title' | 'date' | 'types' | 'doctor' | 'portal' | 'viewer'>;
type AppointmentFields = Pick<AppointmentDraft, 'date' | 'time' | 'professional' | 'specialty' | 'location'>;
type BaseDraft = {id: number; revision: number; recordId?: string; edit?: 'fields' | 'viewer'};
export type Draft = BaseDraft & (
    | {kind: 'study'; fields: StudyFields; document?: DocumentRef}
    | {kind: 'appointment'; fields: AppointmentFields}
);
export interface BotState {draft?: Draft; offset?: number}
export interface Incoming {id: number; text?: string; document?: DocumentRef; action?: string}
export type Button = {text: string; callback_data: string};
export class CalendarSyncPending extends Error {}
interface Services {
    send(text: string, buttons?: Button[][]): Promise<void>;
    persist(): Promise<void>;
    analyze(document: DocumentRef): Promise<ExtractedFields>;
    reserve(): Promise<string>;
    save(draft: Draft): Promise<string>;
    today(): string;
}

function dateIn(text: string, today: string, allowRelative: boolean): string {
    const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
    if (iso) return isValidDate(iso) ? iso : '';
    const local = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?\b/.exec(text);
    if (local) {
        const [, day = '', month = '', year] = local;
        const date = `${year ?? today.slice(0, 4)}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        return isValidDate(date) ? date : '';
    }
    const written = /\b(\d{1,2}) de (\p{L}+)(?: de (\d{4}))?\b/u.exec(normalize(text));
    if (written) {
        const [, day = '', name = '', year] = written;
        const month = months.indexOf(name === 'setiembre' ? 'septiembre' : name) + 1;
        const date = `${year ?? today.slice(0, 4)}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
        if (isValidDate(date)) return date;
    }
    const relative = /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(normalize(text))?.[0];
    if (!allowRelative || !relative) return '';
    const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const date = new Date(`${today}T00:00:00Z`);
    const delta = relative === 'hoy' ? 0 : relative === 'manana' ? 1 : (days.indexOf(relative) - date.getUTCDay() + 7) % 7;
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
}

function timeIn(text: string): string {
    const time = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
        ?? /\b(?:a las\s+)?([01]?\d|2[0-3])(?:\.([0-5]\d))?\s*(?:hs?\.?|horas)\b/i.exec(text);
    return time ? `${time[1]?.padStart(2, '0')}:${time[2] ?? '00'}` : '';
}

function linksIn(text: string): string[] {
    const urls = text.match(/https?:\/\/[^\s<>"]+/gi) ?? [];
    const valid = urls.flatMap(url => {
        try {
            return [viewerURL(url)];
        } catch {
            return [];
        }
    });
    return [...new Set(valid)];
}

function labelsIn(text: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of text.split('\n')) {
        const match = /^\s*([^:]{1,24}):\s*(.*)$/.exec(line);
        if (match?.[1]) fields.set(normalize(match[1]), match[2]?.trim() ?? '');
    }
    return fields;
}

function appointmentFields(text: string, today: string): AppointmentFields {
    const labels = labelsIn(text);
    const phrase = /\bcon\s+(?:(?:la|el)\s+)?(.+?)(?=\s+(?:el|hoy|mañana|a las|en)\b|$)/i.exec(text);
    return {
        date: dateIn(labels.get('fecha') ?? text, today, true),
        time: timeIn(labels.get('hora') ?? text),
        professional: labels.get('profesional') ?? labels.get('medico') ?? phrase?.[1]?.trim() ?? '',
        specialty: labels.get('especialidad') ?? '',
        location: labels.get('lugar') ?? /\ben\s+([^\n]+)$/i.exec(text)?.[1]?.trim() ?? '',
    };
}

function applyLabels(draft: Draft, text: string, today: string): boolean {
    const labels = labelsIn(text);
    let changed = false;
    function update(label: string, apply: (value: string) => void) {
        const value = labels.get(label);
        if (value !== undefined) {
            apply(value);
            changed = true;
        }
    }
    if (draft.kind === 'study') {
        const {fields} = draft;
        update('nombre', value => { fields.title = value; });
        update('fecha', value => { fields.date = dateIn(value, today, false); });
        update('tipo', value => { fields.types = value.split(',').map(type => type.trim()).filter(Boolean); });
        update('profesional', value => { fields.doctor = value; });
        update('institucion', value => { fields.portal = value; });
    } else {
        const {fields} = draft;
        update('fecha', value => { fields.date = dateIn(value, today, true); });
        update('hora', value => { fields.time = timeIn(value); });
        update('profesional', value => { fields.professional = value; });
        update('especialidad', value => { fields.specialty = value; });
        update('lugar', value => { fields.location = value; });
    }
    return changed;
}

function displayDate(value: string): string {
    return isValidDate(value) ? value.split('-').reverse().join('/') : 'Pendiente';
}

export function appointmentDraft(fields: AppointmentFields): AppointmentDraft {
    return {...fields, timeZone: DEFAULT_APPOINTMENT_TIME_ZONE, status: 'scheduled', notes: '', cost: null, coverage: null, calendarReminders: 'standard'};
}

function missing(draft: Draft, today: string): string | undefined {
    const {fields} = draft;
    if (!isValidDate(fields.date)) return 'Completá una fecha válida.';
    if (draft.kind === 'appointment') {
        if (!appointmentInstant(appointmentDraft(draft.fields))) return 'Completá una hora válida.';
        return undefined;
    }
    if (draft.fields.date > today) return 'La fecha del estudio no puede ser futura.';
    if (!draft.fields.title || !draft.fields.types.length) return 'Completá el nombre y el tipo del estudio.';
    if (!draft.fields.viewer && !draft.document) return 'Agregá un PDF o un enlace al visor.';
}

const HELP = 'Mandame un PDF, el enlace al visor, o escribí un turno. Para un turno, incluí fecha y hora. Podés retomar la ficha con /pendiente.';

export function createConversation(state: BotState, services: Services) {
    function button(draft: Draft, text: string, action: string): Button {
        return {text, callback_data: `${action}:${draft.id}:${draft.revision}`};
    }

    async function preview(draft: Draft, notice?: string) {
        const {fields} = draft;
        const lines = draft.kind === 'study'
            ? ['Estudio', `Nombre: ${draft.fields.title || 'Pendiente'}`, `Fecha: ${displayDate(fields.date)}`,
                `Tipo: ${draft.fields.types.join(', ') || 'Pendiente'}`, `Profesional: ${draft.fields.doctor || '—'}`,
                `Institución: ${draft.fields.portal || '—'}`, `PDF: ${draft.document?.name || '—'}`,
                `Visor: ${draft.fields.viewer || '—'}`]
            : ['Turno', `Fecha: ${displayDate(fields.date)}`, `Hora: ${draft.fields.time || 'Pendiente'} (Buenos Aires)`,
                `Profesional: ${draft.fields.professional || '—'}`, `Especialidad: ${draft.fields.specialty || '—'}`,
                `Lugar: ${draft.fields.location || '—'}`];
        const buttons = [[button(draft, draft.recordId ? 'Reintentar guardado' : 'Guardar', 'save')]];
        if (!draft.recordId) {
            buttons[0]?.push(button(draft, 'Corregir', 'edit'), button(draft, 'Cancelar', 'cancel'));
            if (draft.kind === 'study') buttons.push([button(draft, draft.fields.viewer ? 'Cambiar enlace al visor' : 'Agregar enlace al visor', 'viewer')]);
        }
        const prompt = notice ?? missing(draft, services.today());
        if (prompt) lines.push('', prompt);
        await services.send(lines.join('\n'), buttons);
    }

    async function confirm(draft: Draft) {
        const error = missing(draft, services.today());
        if (error) return preview(draft, error);
        let result: string;
        try {
            if (!draft.recordId) {
                draft.recordId = await services.reserve();
            }
            await services.persist();
            result = await services.save(draft);
        } catch (error) {
            return preview(draft, error instanceof CalendarSyncPending
                ? 'El turno quedó guardado en Mis estudios. Tocá el botón para reintentar la sincronización con Calendar.'
                : 'No pude confirmar el guardado. Tocá el botón para reintentar con la misma ficha.');
        }
        delete state.draft;
        await services.persist();
        await services.send(result);
    }

    return async (input: Incoming): Promise<void> => {
        const draft = state.draft;
        const text = input.text?.trim() ?? '';
        if (input.action) {
            const [action, id, revision] = input.action.split(':');
            if (!draft || String(draft.id) !== id || String(draft.revision) !== revision) {
                return services.send('Ese botón ya venció. Usá /pendiente para ver la ficha actual.');
            }
            if (action === 'save') return confirm(draft);
            if (draft.recordId) return preview(draft);
            if (action === 'cancel') {
                delete state.draft;
                await services.persist();
                return services.send('Ficha cancelada.');
            }
            if (action === 'viewer' && draft.kind === 'study') {
                draft.edit = 'viewer';
                await services.persist();
                return services.send('Pegá el enlace al visor. Para quitarlo, respondé /sinlink.');
            }
            if (action === 'edit') {
                draft.edit = 'fields';
                await services.persist();
                return services.send(draft.kind === 'study'
                    ? 'Escribí los datos que querés cambiar, uno por línea.\nNombre: …\nFecha: DD/MM/AAAA\nTipo: …\nProfesional: …\nInstitución: …'
                    : 'Escribí los datos que querés cambiar, uno por línea.\nFecha: DD/MM/AAAA\nHora: HH:MM\nProfesional: …\nEspecialidad: …\nLugar: …');
            }
            return;
        }

        if (text === '/start' || text === '/ayuda') return services.send(HELP);
        if (text === '/pendiente') return draft ? preview(draft) : services.send('No hay ninguna ficha pendiente.');
        if (draft?.recordId) return preview(draft);
        const links = linksIn(text);
        if (draft) {
            let changed = false;
            if (draft.kind === 'study' && (draft.edit === 'viewer' || (links.length === 1 && !input.document && /^https?:\/\/\S+$/i.test(text)))) {
                if (text === '/sinlink' && draft.edit === 'viewer') draft.fields.viewer = '';
                else if (links.length === 1 && /^https?:\/\/\S+$/i.test(text)) draft.fields.viewer = links[0]!;
                else return services.send('Pegá un único enlace válido que empiece con https:// o http://.');
                changed = true;
            } else if (!input.document) {
                changed = applyLabels(draft, text, services.today());
            }
            if (!changed) return preview(draft, 'Tenés una ficha pendiente. Podés completarla o cancelarla desde estos botones.');
            draft.revision++;
            delete draft.edit;
            await services.persist();
            return preview(draft);
        }

        const base = {id: input.id, revision: 0};
        const appointment = !input.document && (/(?:\bturno\b|\bcita\b)/i.test(text) || Boolean(timeIn(text)));
        if (appointment) {
            state.draft = {...base, kind: 'appointment', fields: appointmentFields(text, services.today())};
        } else if (input.document || links.length) {
            let hints: ExtractedFields = {};
            if (input.document) {
                try {
                    hints = await services.analyze(input.document);
                } catch {
                    return services.send('No pude descargar o validar el PDF. Reenviá el archivo como documento o mandame el enlace al visor.');
                }
            }
            const types = hints.types ?? [];
            state.draft = {
                ...base, kind: 'study', document: input.document,
                fields: {
                    title: types.join(' y ') || input.document?.name.replace(/\.pdf$/i, '') || '',
                    date: hints.date ?? '', types, doctor: hints.doctor ?? '', portal: '', viewer: links.length === 1 ? links[0]! : '',
                },
            };
            applyLabels(state.draft, text, services.today());
        } else {
            return services.send(HELP);
        }
        await services.persist();
        await preview(state.draft, state.draft.kind === 'study' && links.length > 1 ? 'Hay varios enlaces. Pegá el del visor con el botón correspondiente.' : undefined);
    };
}
