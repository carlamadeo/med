import type {Appointment, Study} from './models';
import {appointmentInstant, appointmentStatus} from './appointments';

export interface MonthActivity {
    key: string;
    label: string;
    count: number;
}

const monthFormatter = new Intl.DateTimeFormat('es-AR', {month: 'short'});
const relativeFormatter = new Intl.RelativeTimeFormat('es-AR', {numeric: 'auto'});

export function monthlyStudyActivity(
    studies: readonly Study[],
    months = 6,
    now: Date = new Date(),
): MonthActivity[] {
    const counts = new Map<string, number>();
    for (const study of studies) {
        const key = study.date.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(key)) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const result: MonthActivity[] = [];
    for (let offset = months - 1; offset >= 0; offset -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        result.push({
            key,
            label: monthFormatter.format(date).replace('.', ''),
            count: counts.get(key) ?? 0,
        });
    }
    return result;
}

export function latestStudy(studies: readonly Study[]): Study | null {
    let latest: Study | null = null;
    for (const study of studies) {
        if (!latest || study.date > latest.date || (study.date === latest.date && study.title.localeCompare(latest.title, 'es-AR') < 0)) {
            latest = study;
        }
    }
    return latest;
}

export function upcomingAppointment(
    appointments: readonly Appointment[],
    now: Date = new Date(),
): Appointment | null {
    return appointments
        .filter((appointment) => appointment.status === 'scheduled' && appointmentStatus(appointment, now) === 'upcoming')
        .sort((a, b) => (appointmentInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY) - (appointmentInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY))[0] ?? null;
}

export function relativeDayLabel(date: string, now: Date = new Date()): string {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return date;
    const target = Date.UTC(year, month - 1, day);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return relativeFormatter.format(Math.round((target - today) / 86_400_000), 'day');
}

export type StudySyncState = 'synced' | 'pending' | 'conflict' | 'failed';

export function studySyncState(study: Pick<Study, 'syncStatus'>): StudySyncState {
    if (study.syncStatus === 'conflict') return 'conflict';
    if (study.syncStatus === 'failed') return 'failed';
    if (study.syncStatus === 'pending') return 'pending';
    return 'synced';
}