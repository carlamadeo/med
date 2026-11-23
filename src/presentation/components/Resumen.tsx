import {upcomingAppointment} from '@domain/summary';
import {computeEpisodesAggregate, formatMonth} from '@domain/episodes-aggregate';
import type {Episode, Appointment, Operation, MedicalEvent} from '@domain/models';
import {
    error,
    loading,
    offline,
    pendingChanges,
    visibleAppointments,
    visibleEpisodes,
    visibleOperations,
    visibleMedicalEvents,
    visibleStudies,
} from '../state/store';
import {SummaryChart} from './SummaryChart';

const syncLabels = {
    pending: 'Pendiente',
    conflict: 'Conflicto',
    failed: 'Sin sincronizar',
} as const;

function monthDay(date: string): { month: string; day: string } {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return {month: '', day: ''};
    const label = new Intl.DateTimeFormat('es-AR', {month: 'short'}).format(new Date(year, month - 1, 1));
    return {month: label.replace('.', ''), day: String(day)};
}

function computeHealthActivity(episodes: readonly Episode[], appointments: readonly Appointment[], operations: readonly Operation[], months = 6) {
    const now = new Date();
    const result: Array<{ key: string; label: string; count: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const label = new Intl.DateTimeFormat('es-AR', {month: 'short'}).format(date);
        let count = 0;
        for (const ep of episodes) {
            for (const obs of ep.observations) {
                if (obs.date.startsWith(monthKey)) {
                    count++;
                    break;
                }
            }
        }
        for (const ap of appointments) {
            if (ap.date.startsWith(monthKey)) count++;
        }
        for (const op of operations) {
            if (op.date?.startsWith(monthKey)) count++;
        }
        result.push({key: monthKey, label, count});
    }
    return result;
}

function getActiveEpisodes(episodes: readonly Episode[]) {
    return episodes.filter(ep => !ep.closed && !ep.endDate);
}

function getCurrentMedications(episodes: readonly Episode[]) {
    const meds = new Map<string, { name: string; frequency?: string; count: number }>();
    for (const ep of episodes) {
        if (ep.closed || ep.endDate) continue;
        for (const med of ep.medications) {
            const name = med.name.trim();
            if (!name) continue;
            const existing = meds.get(name.toLowerCase()) ?? {name, frequency: med.frequency, count: 0};
            existing.count++;
            meds.set(name.toLowerCase(), existing);
        }
    }
    return [...meds.values()].sort((a, b) => b.count - a.count);
}

function getTopSymptomsActive(episodes: readonly Episode[], limit = 3) {
    const freq = new Map<string, { count: number; maxIntensity: number }>();
    for (const ep of episodes) {
        if (ep.closed || ep.endDate) continue;
        for (const obs of ep.observations) {
            for (const sym of obs.symptoms) {
                const name = sym.name.trim().toLowerCase();
                if (!name) continue;
                const existing = freq.get(name) ?? {count: 0, maxIntensity: 0};
                existing.count++;
                if (sym.intensity !== undefined) existing.maxIntensity = Math.max(existing.maxIntensity, sym.intensity);
                freq.set(name, existing);
            }
        }
    }
    return [...freq.entries()]
        .map(([name, data]) => ({name, count: data.count, maxIntensity: data.maxIntensity}))
        .sort((a, b) => b.count - a.count || b.maxIntensity - a.maxIntensity)
        .slice(0, limit);
}

function getRecentOperation(operations: readonly Operation[]) {
    const withDate = operations.filter(op => op.date).sort((a, b) => b.date!.localeCompare(a.date!));
    return withDate[0] ?? null;
}

function getAppointmentsThisMonth(appointments: readonly Appointment[]) {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return appointments.filter(ap => ap.date.startsWith(monthKey)).length;
}

function getSpecialtiesThisYear(appointments: readonly Appointment[], events: readonly MedicalEvent[]) {
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01`;
    const specs = new Set<string>();
    for (const ap of appointments) {
        if (ap.date >= yearStart && ap.specialty) specs.add(ap.specialty);
    }
    for (const ev of events) {
        if (ev.date >= yearStart && ev.specialty) specs.add(ev.specialty);
    }
    return [...specs].slice(0, 5);
}

export function Resumen() {
    const episodes = visibleEpisodes.value;
    const appointments = visibleAppointments.value;
    const operations = visibleOperations.value;
    const medicalEvents = visibleMedicalEvents.value;
    const studies = visibleStudies.value;

    const activeEpisodes = getActiveEpisodes(episodes);
    const aggregate = computeEpisodesAggregate(episodes, 'year');
    const currentMeds = getCurrentMedications(episodes);
    const topActiveSymptoms = getTopSymptomsActive(episodes);
    const recentOp = getRecentOperation(operations);
    const appointmentsThisMonth = getAppointmentsThisMonth(appointments);
    const specialties = getSpecialtiesThisYear(appointments, medicalEvents);
    const healthActivity = computeHealthActivity(episodes, appointments, operations, 6);
    const appointment = upcomingAppointment(appointments);
    const appointmentDate = appointment ? monthDay(appointment.date) : null;
    const totalEpisodesThisYear = aggregate.totalEpisodes;
    const totalDaysIllThisYear = aggregate.totalDaysIll;
    const pending = pendingChanges.value;
    const conflicts = pending.filter((entry) => entry.status === 'conflict').length;

    const activityThisMonth = healthActivity[healthActivity.length - 1]?.count ?? 0;
    const totalActivity = healthActivity.reduce((sum, item) => sum + item.count, 0);
    const averageActivity = healthActivity.length ? totalActivity / healthActivity.length : 0;
    const bestMonth = healthActivity.reduce((top, item) => (item.count > top.count ? item : top), healthActivity[0] ?? {
        key: '',
        label: '',
        count: 0
    });

    if (loading.value && studies.length === 0 && episodes.length === 0 && appointments.length === 0) {
        return (
            <div className="resumen" id="resumen" aria-busy="true" aria-label="Cargando el resumen">
                <div className="kpi-grid">
                    {[0, 1, 2, 3].map((item) => (
                        <article className="card kpi-card" key={item}>
                            <div className="skeleton skeleton-line"/>
                            <div className="skeleton skeleton-value"/>
                            <div className="skeleton skeleton-line short"/>
                        </article>
                    ))}
                </div>
                <div className="card skeleton-panel"/>
            </div>
        );
    }

    if (error.value && studies.length === 0 && episodes.length === 0 && appointments.length === 0) {
        return (
            <div className="resumen" id="resumen">
                <section className="card resumen-state" role="alert">
                    <span className="resumen-state-icon" aria-hidden="true">
                        <svg className="icon"><use href="#i-alert"/></svg>
                    </span>
                    <h2>No se pudo abrir el archivo</h2>
                    <p>{error.value}</p>
                </section>
            </div>
        );
    }

    return (
        <div className="resumen" id="resumen">
            {(offline.value || pending.length > 0) && (
                <p className="offline-notice" role="status">
                    {offline.value ? 'Sin conexión. ' : ''}
                    {conflicts ? `${conflicts} ${conflicts === 1 ? 'cambio requiere' : 'cambios requieren'} revisión.`
                        : pending.length ? `${pending.length} ${pending.length === 1 ? 'cambio pendiente' : 'cambios pendientes'} de sincronización.`
                            : 'Mostrando la copia de este dispositivo.'}
                </p>
            )}

            <div className="kpi-grid">
                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Episodios activos</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-activity"/></svg></span>
                    </div>
                    <p className="kpi-value">{activeEpisodes.length}</p>
                    <div className="kpi-foot">
                        <span
                            className="kpi-note">{activeEpisodes.length === 1 ? 'episodio en curso' : 'episodios en curso'}</span>
                    </div>
                </article>

                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Días enfermo (año)</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-calendar"/></svg></span>
                    </div>
                    <p className="kpi-value">{totalDaysIllThisYear}</p>
                    <div className="kpi-foot">
                        <span className="delta"
                              data-tone="neutral">{totalEpisodesThisYear} {totalEpisodesThisYear === 1 ? 'episodio' : 'episodios'}</span>
                        <span className="kpi-note">este año</span>
                    </div>
                </article>

                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Medicamentos actuales</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-pill"/></svg></span>
                    </div>
                    <p className="kpi-value">{currentMeds.length}</p>
                    <div className="kpi-foot">
                        <span
                            className="kpi-note">{currentMeds.slice(0, 2).map(m => m.name).join(', ') || 'ninguno'}</span>
                    </div>
                </article>

                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Operaciones</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-scissors"/></svg></span>
                    </div>
                    <p className="kpi-value">{operations.length}</p>
                    <div className="kpi-foot">
                        <span
                            className="kpi-note">{recentOp ? `${recentOp.name} (${formatMonth(recentOp.date!.slice(0, 7))})` : 'sin registros'}</span>
                    </div>
                </article>
            </div>

            <div className="resumen-grid">
                <section className="card chart-card" aria-labelledby="activity-title">
                    <div className="chart-head">
                        <div>
                            <h2 className="card-title" id="activity-title">Actividad de salud</h2>
                            <p className="card-desc">Episodios + turnos + operaciones por mes</p>
                            <div className="chart-headline">
                                <span className="chart-total">{totalActivity}</span>
                                <span className="chart-delta"><svg className="icon"><use
                                    href="#i-trend"/></svg> +{activityThisMonth} este mes</span>
                            </div>
                        </div>
                    </div>

                    <div className="chart-wrap">
                        <SummaryChart data={healthActivity}/>
                        {totalActivity === 0 &&
                            <p className="chart-empty">Todavía no hay actividad de salud en este período.</p>}
                    </div>

                    <dl className="chart-foot">
                        <div>
                            <dt>Este mes</dt>
                            <dd>{activityThisMonth}</dd>
                        </div>
                        <div>
                            <dt>Promedio</dt>
                            <dd>{averageActivity.toLocaleString('es-AR', {maximumFractionDigits: 1})} por mes</dd>
                        </div>
                        <div>
                            <dt>Mes con más actividad</dt>
                            <dd>{bestMonth.count ? `${bestMonth.label} · ${bestMonth.count}` : '—'}</dd>
                        </div>
                    </dl>
                </section>

                <div className="resumen-side">
                    <section className="card side-card" aria-labelledby="next-appointment-title">
                        <div className="side-head">
                            <h2 className="card-title" id="next-appointment-title">Próximo turno</h2>
                            {appointment && <span className="tag tag-primary">
                                {appointment.syncStatus ? syncLabels[appointment.syncStatus] : 'Confirmado'}
                            </span>}
                        </div>

                        {appointment && appointmentDate ? (
                            <div className="appointment">
                                <div className="date-tile"
                                     aria-label={`${appointmentDate.day} de ${appointmentDate.month}`}>
                                    <span>{appointmentDate.month}</span>
                                    <strong>{appointmentDate.day}</strong>
                                </div>
                                <div className="appointment-body">
                                    <p className="appointment-title">{appointment.professional || 'Turno médico'}</p>
                                    <p className="appointment-meta">
                                        {appointment.time}
                                        {appointment.specialty && ` · ${appointment.specialty}`}
                                        {appointment.coverage && ` · Cobertura: ${appointment.coverage === 'all' ? 'Total' : appointment.coverage === 'partial' ? 'Parcial' : 'Ninguna'}`}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="side-empty">No hay turnos próximos.</p>
                        )}
                    </section>

                    <section className="card side-card" aria-labelledby="insights-title">
                        <div className="side-head">
                            <h2 className="card-title" id="insights-title">Resumen rápido</h2>
                        </div>
                        <div className="insights-list">
                            {activeEpisodes.length > 0 && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-alert"/>
                                    </svg>
                                    <span>{activeEpisodes.length} episodio{activeEpisodes.length !== 1 ? 's' : ''} en curso: {activeEpisodes.map(e => e.illness || 'Salud').join(', ')}</span>
                                </div>
                            )}
                            {topActiveSymptoms.length > 0 && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-activity"/>
                                    </svg>
                                    <span>Síntomas activos: {topActiveSymptoms.map(s => `${s.name}${s.maxIntensity ? ` (${s.maxIntensity}/5)` : ''}`).join(', ')}</span>
                                </div>
                            )}
                            {currentMeds.length > 0 && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-pill"/>
                                    </svg>
                                    <span>Medicación: {currentMeds.slice(0, 3).map(m => `${m.name}${m.frequency ? ` ${m.frequency}` : ''}`).join('; ')}</span>
                                </div>
                            )}
                            {appointmentsThisMonth > 0 && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-calendar"/>
                                    </svg>
                                    <span>{appointmentsThisMonth} turno{appointmentsThisMonth !== 1 ? 's' : ''} este mes</span>
                                </div>
                            )}
                            {specialties.length > 0 && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-stethoscope"/>
                                    </svg>
                                    <span>Especialidades este año: {specialties.join(', ')}</span>
                                </div>
                            )}
                            {recentOp && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-scissors"/>
                                    </svg>
                                    <span>Última operación: {recentOp.name} ({formatMonth(recentOp.date!.slice(0, 7))})</span>
                                </div>
                            )}
                            {activeEpisodes.length === 0 && currentMeds.length === 0 && appointmentsThisMonth === 0 && (
                                <div className="insight-item">
                                    <svg className="icon insight-icon" aria-hidden="true">
                                        <use href="#i-check"/>
                                    </svg>
                                    <span>Sin episodios activos ni turnos próximos. ¡Todo tranquilo!</span>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
