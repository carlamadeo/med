import {formatStudyDate, portalNames, reportUrl} from '@domain/library';
import {
    latestStudy,
    monthlyStudyActivity,
    relativeDayLabel,
    studySyncState,
    upcomingAppointment
} from '@domain/summary';
import type {Study, ViewMode} from '@domain/models';
import {
    error,
    isSourceUnavailable,
    loading,
    offline,
    pendingChanges,
    portals,
    studies,
    visibleAppointments,
    visibleStudies,
} from '../state/store';
import {SummaryChart} from './SummaryChart';

interface ResumenProps {
    typesReady: boolean;
    onAddStudy: () => void;
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare: (study: Study) => void;
    onNavigate: (view: ViewMode) => void;
    onRetryLoad: () => void;
}

const syncMeta = {
    synced: {label: 'Sincronizado', tone: 'success', icon: 'i-check'},
    pending: {label: 'Pendiente', tone: 'warning', icon: 'i-clock'},
    conflict: {label: 'Conflicto', tone: 'danger', icon: 'i-alert'},
    failed: {label: 'Sin sincronizar', tone: 'danger', icon: 'i-alert'},
} as const;

function monthDay(date: string): { month: string; day: string } {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return {month: '', day: ''};
    const label = new Intl.DateTimeFormat('es-AR', {month: 'short'}).format(new Date(year, month - 1, 1));
    return {month: label.replace('.', ''), day: String(day)};
}

export function Resumen({
                            typesReady,
                            onAddStudy,
                            onEdit,
                            onDelete,
                            onShare,
                            onNavigate,
                            onRetryLoad,
                        }: ResumenProps) {
    const all = visibleStudies.value;
    const latest = latestStudy(all);
    const activity = monthlyStudyActivity(all, 6);
    const thisMonth = activity[activity.length - 1]?.count ?? 0;
    const total = all.length;
    const pending = pendingChanges.value;
    const conflicts = pending.filter((entry) => entry.status === 'conflict').length;
    const failed = pending.filter((entry) => entry.status === 'failed').length;
    const appointment = upcomingAppointment(visibleAppointments.value);
    const appointmentDate = appointment ? monthDay(appointment.date) : null;
    const recent = [...all]
        .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'))
        .slice(0, 5);
    const portalCount = portals.value.length || portalNames(all).length;
    const average = activity.length ? activity.reduce((sum, item) => sum + item.count, 0) / activity.length : 0;
    const best = activity.reduce((top, item) => (item.count > top.count ? item : top), activity[0] ?? {
        key: '',
        label: '',
        count: 0
    });

    if (loading.value && total === 0) {
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

    if (error.value && total === 0) {
        return (
            <div className="resumen" id="resumen">
                <section className="card resumen-state" role="alert">
          <span className="resumen-state-icon" aria-hidden="true">
            <svg className="icon"><use href="#i-alert"/></svg>
          </span>
                    <h2>No se pudo abrir el archivo</h2>
                    <p>{error.value}</p>
                    <button className="button primary" type="button" onClick={onRetryLoad}>
                        <svg className="icon">
                            <use href="#i-refresh"/>
                        </svg>
                        Reintentar
                    </button>
                </section>
            </div>
        );
    }

    return (
        <div className="resumen" id="resumen">
            <div className="kpi-grid">
                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Estudios totales</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-file"/></svg></span>
                    </div>
                    <p className="kpi-value">{total.toLocaleString('es-AR')}</p>
                    <div className="kpi-foot">
                        <span className="delta"><svg className="icon"><use href="#i-trend"/></svg> +{thisMonth} este mes</span>
                        <span className="kpi-note">archivo privado</span>
                    </div>
                </article>

                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Último estudio</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-clock"/></svg></span>
                    </div>
                    <p className="kpi-value kpi-value-text">{latest ? relativeDayLabel(latest.date) : '—'}</p>
                    <div className="kpi-foot">
                        <span className="kpi-note">{latest ? latest.title : 'Sin registros'}</span>
                    </div>
                </article>

                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Portales</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-globe"/></svg></span>
                    </div>
                    <p className="kpi-value">{portalCount}</p>
                    <div className="kpi-foot">
                        <span className="kpi-note">instituciones guardadas</span>
                    </div>
                </article>

                <article className="card kpi-card">
                    <div className="kpi-top">
                        <span className="kpi-label">Pendientes de sincronizar</span>
                        <span className="kpi-icon"><svg className="icon"><use href="#i-refresh"/></svg></span>
                    </div>
                    <p className="kpi-value">{pending.length}</p>
                    <div className="kpi-foot">
            <span className="delta" data-tone={pending.length ? 'warning' : 'neutral'}>
              <svg className="icon"><use href={conflicts ? '#i-alert' : '#i-clock'}/></svg>
                {conflicts ? `${conflicts} ${conflicts === 1 ? 'conflicto' : 'conflictos'}` : failed ? `${failed} con error` : 'todo al día'}
            </span>
                        <span className="kpi-note">{offline.value ? 'sin conexión' : 'Google Drive'}</span>
                    </div>
                </article>
            </div>

            <div className="resumen-grid">
                <section className="card chart-card" aria-labelledby="activity-title">
                    <div className="chart-head">
                        <div>
                            <h2 className="card-title" id="activity-title">Actividad del archivo</h2>
                            <p className="card-desc">Estudios agregados por mes</p>
                            <div className="chart-headline">
                                <span className="chart-total">{total.toLocaleString('es-AR')}</span>
                                <span className="chart-delta"><svg className="icon"><use
                                    href="#i-trend"/></svg> +{thisMonth} este mes</span>
                            </div>
                        </div>
                    </div>

                    <div className="chart-wrap">
                        <SummaryChart data={activity}/>
                        {total === 0 && <p className="chart-empty">Todavía no hay estudios en este período.</p>}
                    </div>

                    <dl className="chart-foot">
                        <div>
                            <dt>Este mes</dt>
                            <dd>+{thisMonth}</dd>
                        </div>
                        <div>
                            <dt>Promedio</dt>
                            <dd>{average.toLocaleString('es-AR', {maximumFractionDigits: 1})} por mes</dd>
                        </div>
                        <div>
                            <dt>Mejor mes</dt>
                            <dd>{best.count ? `${best.label} · ${best.count}` : '—'}</dd>
                        </div>
                    </dl>
                </section>

                <div className="resumen-side">
                    <section className="card side-card" aria-labelledby="next-appointment-title">
                        <div className="side-head">
                            <h2 className="card-title" id="next-appointment-title">Próximo turno</h2>
                            {appointment && <span className="tag tag-primary">Confirmado</span>}
                        </div>

                        {appointment && appointmentDate ? (
                            <>
                                <div className="appointment">
                                    <div className="date-tile"
                                         aria-label={`${appointmentDate.day} de ${appointmentDate.month}`}>
                                        <span>{appointmentDate.month}</span>
                                        <strong>{appointmentDate.day}</strong>
                                    </div>
                                    <div className="appointment-body">
                                        <p className="appointment-title">{appointment.professional || 'Turno médico'}</p>
                                        <p className="appointment-meta">{appointment.time} · {appointment.notes || appointment.timeZone}</p>
                                    </div>
                                </div>
                                <div className="side-foot">
                                    <button className="button secondary button-sm" type="button"
                                            onClick={() => onNavigate('turnos')}>Ver turnos
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="side-empty">
                                <p>No hay turnos próximos.</p>
                                <button className="button secondary button-sm" type="button"
                                        onClick={() => onNavigate('turnos')}>Agendar turno
                                </button>
                            </div>
                        )}
                    </section>

                    <section className="card side-card" aria-labelledby="sync-title">
                        <div className="side-head">
                            <h2 className="card-title" id="sync-title">Google Drive</h2>
                            <span className="sync-state">
                <span className="status-dot" data-tone={offline.value ? 'warning' : 'success'} aria-hidden="true"/>
                                {offline.value ? 'Sin conexión' : 'Conectado'}
              </span>
                        </div>
                        <div className="sync-icon-row">
                            <span className="sync-icon"><svg className="icon"><use href="#i-drive"/></svg></span>
                            <p className="sync-copy">Carpeta «Mis estudios»<br/><span>Cuenta privada y verificada</span>
                            </p>
                        </div>
                        <dl className="sync-list">
                            <div>
                                <dt>Estudios en Drive</dt>
                                <dd>{studies.value.length}</dd>
                            </div>
                            <div>
                                <dt>Cambios pendientes</dt>
                                <dd>{pending.length}</dd>
                            </div>
                            <div>
                                <dt>Conflictos</dt>
                                <dd>{conflicts}</dd>
                            </div>
                        </dl>
                        {offline.value ? (
                            <p className="sync-alert" data-tone="warning">
                                <svg className="icon">
                                    <use href="#i-wifi-off"/>
                                </svg>
                                Estás viendo la última copia disponible en este dispositivo.
                            </p>
                        ) : pending.length ? (
                            <p className="sync-alert" data-tone="warning">
                                <svg className="icon">
                                    <use href="#i-clock"/>
                                </svg>
                                {pending.length} {pending.length === 1 ? 'cambio espera' : 'cambios esperan'} sincronización.
                            </p>
                        ) : (
                            <p className="sync-alert" data-tone="success">
                                <svg className="icon">
                                    <use href="#i-check"/>
                                </svg>
                                Todo sincronizado con Drive.
                            </p>
                        )}
                        {pending.length > 0 && (
                            <button
                                className="button secondary button-sm sync-action"
                                type="button"
                                onClick={() => document.getElementById('pending-changes')?.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'start'
                                })}
                            >
                                Revisar pendientes
                            </button>
                        )}
                    </section>
                </div>
            </div>

            <section className="card recent-card" aria-labelledby="recent-title">
                <div className="recent-head">
                    <div>
                        <h2 className="card-title" id="recent-title">Estudios recientes</h2>
                        <p className="card-desc">Los últimos cinco del archivo</p>
                    </div>
                    <div className="recent-actions">
                        <span className="count-badge">{total}</span>
                        <button className="button secondary button-sm" type="button"
                                onClick={() => onNavigate('cronologia')}>Ver biblioteca
                        </button>
                    </div>
                </div>

                <div className="summary-table-scroll">
                    <table>
                        <caption className="sr-only">Últimos estudios guardados en el archivo</caption>
                        <thead>
                        <tr>
                            <th scope="col">Estudio</th>
                            <th scope="col">Fecha</th>
                            <th scope="col">Profesional</th>
                            <th scope="col">Portal</th>
                            <th scope="col">Estado</th>
                            <th scope="col"><span className="sr-only">Acciones</span></th>
                        </tr>
                        </thead>
                        <tbody>
                        {recent.length === 0 ? (
                            <tr>
                                <td colSpan={6}>
                                    <div className="table-empty">
                                        <p>Tu archivo empieza acá.</p>
                                        <button className="button secondary button-sm" type="button"
                                                onClick={onAddStudy} disabled={!typesReady}>
                                            <svg className="icon">
                                                <use href="#i-plus"/>
                                            </svg>
                                            Agregar estudio
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ) : recent.map((study) => {
                            const state = syncMeta[studySyncState(study)];
                            const pdfAvailable = study.hasPdf && !isSourceUnavailable(study.driveFileId);
                            const viewerAvailable = Boolean(study.viewer) && !isSourceUnavailable(study.viewer);
                            return (
                                <tr key={study.id}>
                                    <td>
                                        <div className="study-cell">
                                            <span className="study-icon"><svg className="icon"><use
                                                href="#i-file"/></svg></span>
                                            <span className="study-text">
                          <span className="study-title">{study.title}</span>
                          <span className="study-types">
                            {study.types.length ? study.types.slice(0, 2).map((type) => <span className="type-badge"
                                                                                              key={type}>{type}</span>) :
                                <span className="type-badge">Sin tipo</span>}
                          </span>
                        </span>
                                        </div>
                                    </td>
                                    <td>
                                        <time className="date-cell"
                                              dateTime={study.date}>{formatStudyDate(study.date)}</time>
                                    </td>
                                    <td className="person-cell">{study.doctor || '—'}</td>
                                    <td className="portal-cell">{study.portal || '—'}</td>
                                    <td>
                      <span className="status-pill" data-tone={state.tone}>
                        <svg className="icon"><use href={`#${state.icon}`}/></svg>
                          {state.label}
                      </span>
                                    </td>
                                    <td>
                                        <div className="row-actions">
                                            {pdfAvailable && (
                                                <a className="icon-button" href={reportUrl(study.driveFileId)}
                                                   target="_blank" rel="noopener noreferrer"
                                                   aria-label={`Abrir PDF de ${study.title}`}>
                                                    <svg className="icon">
                                                        <use href="#i-external"/>
                                                    </svg>
                                                </a>
                                            )}
                                            {viewerAvailable && (
                                                <a className="icon-button" href={study.viewer} target="_blank"
                                                   rel="noopener noreferrer"
                                                   aria-label={`Abrir visor de ${study.title}`}>
                                                    <svg className="icon">
                                                        <use href="#i-eye"/>
                                                    </svg>
                                                </a>
                                            )}
                                            <button className="icon-button" type="button"
                                                    disabled={Boolean(study.syncStatus)}
                                                    aria-label={`Editar ${study.title}`} onClick={() => onEdit(study)}>
                                                <svg className="icon">
                                                    <use href="#i-edit"/>
                                                </svg>
                                            </button>
                                            <button className="icon-button" type="button"
                                                    disabled={Boolean(study.syncStatus)}
                                                    aria-label={`Eliminar ${study.title}`}
                                                    onClick={() => onDelete(study)}>
                                                <svg className="icon">
                                                    <use href="#i-trash"/>
                                                </svg>
                                            </button>
                                            <button className="icon-button" type="button"
                                                    disabled={Boolean(study.syncStatus) || !(study.hasPdf || study.viewer || study.documentIds?.length)}
                                                    aria-label={`Compartir ${study.title}`}
                                                    onClick={() => onShare(study)}>
                                                <svg className="icon">
                                                    <use href="#i-share"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>

                <div className="recent-foot">
                    <span>Mostrando {recent.length} de {total} estudios</span>
                    <span className="recent-hint">Datos privados de este dispositivo</span>
                </div>
            </section>
        </div>
    );
}