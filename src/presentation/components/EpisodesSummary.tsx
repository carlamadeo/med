import {useMemo, useState} from 'preact/hooks';
import {formatStudyDate} from '@domain/library';
import {computeEpisodesAggregate, formatMonth, shortMonth, type Period} from '@domain/episodes-aggregate';
import type {Episode} from '@domain/models';

interface EpisodesSummaryProps {
    episodes: readonly Episode[];
    initialPeriod?: Period;
}

const periods: {value: Period; label: string}[] = [
    {value: 'year', label: 'Año actual'},
    {value: '12months', label: '12 meses'},
    {value: 'all', label: 'Todo el tiempo'},
];
const decimal = new Intl.NumberFormat('es-AR', {maximumFractionDigits: 1});

export function EpisodesSummary({episodes, initialPeriod = '12months'}: EpisodesSummaryProps) {
    const [period, setPeriod] = useState<Period>(initialPeriod);
    const [expanded, setExpanded] = useState(false);

    const aggregate = useMemo(() => computeEpisodesAggregate(episodes, period), [episodes, period]);

    if (!episodes.length) return null;

    const header = (
        <header className="summary-header">
            <h3 id="episodes-summary-title">Resumen de episodios</h3>
            <div className="summary-tabs" role="group" aria-label="Período del resumen">
                {periods.map(({value, label}) => (
                    <button key={value} type="button" className="button ghost summary-tab"
                            aria-pressed={period === value} onClick={() => setPeriod(value)}>
                        {label}
                    </button>
                ))}
            </div>
        </header>
    );

    if (!aggregate.totalEpisodes) return (
        <section className="episodes-summary" aria-labelledby="episodes-summary-title">
            {header}
            <p className="summary-empty" role="status">No hay episodios en este período.</p>
        </section>
    );

    const severity = aggregate.severityDistribution.high > 0 ? 'high'
        : aggregate.severityDistribution.medium > 0 ? 'medium' : 'low';
    const mostFrequentIllness = aggregate.mostFrequentIllness || '—';
    const busiestMonth = Math.max(1, ...aggregate.monthlyFrequency.map(month => month.count));

    return (
        <section className="episodes-summary" aria-labelledby="episodes-summary-title">
            {header}

            <div className="summary-kpis">
                <div className="kpi">
                    <span className="summary-kpi-value">{aggregate.totalEpisodes}</span>
                    <span className="summary-kpi-label">Episodios</span>
                </div>
                <div className="kpi">
                    <span className="summary-kpi-value">{aggregate.totalDaysIll}</span>
                    <span className="summary-kpi-label">Días de enfermedad</span>
                </div>
                <div className="kpi">
                    <span className="summary-kpi-value">{decimal.format(aggregate.avgDuration)}</span>
                    <span className="summary-kpi-label">Días por episodio</span>
                </div>
                <div className="kpi">
                    <span className="summary-kpi-value">{mostFrequentIllness}</span>
                    <span className="summary-kpi-label">Más frecuente</span>
                </div>
                <div className="kpi" data-severity={severity}>
                    <span className="summary-kpi-value">{severity === 'high' ? 'Alta' : severity === 'medium' ? 'Media' : 'Baja'}</span>
                    <span className="summary-kpi-label">Mayor severidad</span>
                </div>
            </div>

            <div className="summary-grids">
                <div className="summary-section">
                    <h4>Episodios por mes</h4>
                    {period === 'all' && <p className="no-data">Últimos {aggregate.monthlyFrequency.length} meses</p>}
                    <ul className="monthly-heatmap" role="list" aria-label="Episodios por mes">
                        {aggregate.monthlyFrequency.map(month => {
                            const label = `${formatMonth(month.month)}: ${month.count} ${month.count === 1 ? 'episodio' : 'episodios'}`;
                            return (
                                <li key={month.month} className="heatmap-cell" title={label}
                                    data-active={month.count > 0}
                                    style={{'--intensity': month.count / busiestMonth}}>
                                    <span className="sr-only">{label}</span>
                                    <span className="cell-label" aria-hidden="true">
                                        {period === 'all' ? formatMonth(month.month) : shortMonth(month.month)}
                                    </span>
                                    <span className="cell-value" aria-hidden="true">{month.count}</span>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                <div className="summary-section">
                    <h4>Enfermedades</h4>
                    <div className="summary-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Enfermedad</th>
                                    <th>Ep.</th>
                                    <th>Días</th>
                                    <th>Prom.</th>
                                    <th>Última</th>
                                </tr>
                            </thead>
                            <tbody>
                                {aggregate.illnessBreakdown.slice(0, 8).map((ill, idx) => (
                                    <tr key={`${ill.illness}-${idx}`}>
                                        <td><span className="illness-name">{ill.illness}</span></td>
                                        <td>{ill.count}</td>
                                        <td>{ill.totalDays}</td>
                                        <td>{decimal.format(ill.avgDuration)}</td>
                                        <td>{ill.lastDate ? formatStudyDate(ill.lastDate) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="summary-grids">
                <div className="summary-section">
                    <h4>Síntomas principales</h4>
                    <div className="symptoms-chips">
                        {aggregate.topSymptoms.slice(0, 6).map((sym, idx) => (
                            <span key={`${sym.name}-${idx}`} className="symptom-chip">
                                <span className="symptom-name">{sym.name}</span>
                                <span className="symptom-count">×{sym.totalCount}</span>
                                {sym.avgIntensity > 0 && (
                                    <span className="symptom-intensity">{decimal.format(sym.avgIntensity)}/5</span>
                                )}
                            </span>
                        ))}
                        {!aggregate.topSymptoms.length && <span className="no-data">Sin síntomas registrados</span>}
                    </div>
                </div>

                <div className="summary-section">
                    <h4>Medicamentos</h4>
                    <div className="medications-chips">
                        {aggregate.topMedications.slice(0, 8).map((med, idx) => (
                            <span key={`${med.name}-${idx}`} className="medication-chip">
                                {med.name} <span className="med-count">({med.count})</span>
                            </span>
                        ))}
                        {!aggregate.topMedications.length && <span className="no-data">Sin medicamentos registrados</span>}
                    </div>
                </div>
            </div>

            <button
                type="button"
                className="button secondary summary-expand"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
            >
                {expanded ? 'Ocultar análisis completo' : 'Ver análisis completo'}
                <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
            </button>

            {expanded && (
                <div className="episodes-analysis" role="region" aria-label="Análisis detallado">
                    <div className="analysis-section">
                        <h4>Distribución de severidad</h4>
                        <div className="severity-bars">
                            <div className="severity-bar low">
                                <span className="bar-label">Baja</span>
                                <div className="bar-track"><div className="bar-fill" style={{width: `${aggregate.totalEpisodes > 0 ? (aggregate.severityDistribution.low / aggregate.totalEpisodes * 100) : 0}%`}}></div></div>
                                <span className="bar-value">{aggregate.severityDistribution.low}</span>
                            </div>
                            <div className="severity-bar medium">
                                <span className="bar-label">Media</span>
                                <div className="bar-track"><div className="bar-fill" style={{width: `${aggregate.totalEpisodes > 0 ? (aggregate.severityDistribution.medium / aggregate.totalEpisodes * 100) : 0}%`}}></div></div>
                                <span className="bar-value">{aggregate.severityDistribution.medium}</span>
                            </div>
                            <div className="severity-bar high">
                                <span className="bar-label">Alta</span>
                                <div className="bar-track"><div className="bar-fill" style={{width: `${aggregate.totalEpisodes > 0 ? (aggregate.severityDistribution.high / aggregate.totalEpisodes * 100) : 0}%`}}></div></div>
                                <span className="bar-value">{aggregate.severityDistribution.high}</span>
                            </div>
                        </div>
                    </div>

                    <div className="analysis-section">
                        <h4>Episodio más largo</h4>
                        {aggregate.longestEpisode ? (
                            <div className="longest-episode">
                                <span className="longest-illness">{aggregate.longestEpisode.illness}</span>
                                <span className="longest-days">{aggregate.longestEpisode.days} días</span>
                                <span className="longest-range">{formatStudyDate(aggregate.longestEpisode.start)} – {formatStudyDate(aggregate.longestEpisode.end)}</span>
                            </div>
                        ) : (
                            <span className="no-data">—</span>
                        )}
                    </div>

                    <div className="analysis-section">
                        <h4>Tabla completa de enfermedades</h4>
                        <div className="summary-table full" tabIndex={0} role="region" aria-label="Tabla completa de enfermedades">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Enfermedad</th>
                                        <th>Episodios</th>
                                        <th>Días totales</th>
                                        <th>Promedio</th>
                                        <th>Última vez</th>
                                        <th>Severidad</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {aggregate.illnessBreakdown.map((ill, idx) => (
                                        <tr key={`${ill.illness}-${idx}`}>
                                            <td><span className="illness-name">{ill.illness}</span></td>
                                            <td>{ill.count}</td>
                                            <td>{ill.totalDays}</td>
                                            <td>{decimal.format(ill.avgDuration)}</td>
                                            <td>{ill.lastDate ? formatStudyDate(ill.lastDate) : '—'}</td>
                                            <td><span className={`severity-pill ${ill.severity}`}>{ill.severity === 'high' ? 'Alta' : ill.severity === 'medium' ? 'Media' : 'Baja'}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="analysis-section">
                        <h4>Top 10 síntomas</h4>
                        <div className="summary-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Síntoma</th>
                                        <th>Ocurrencias</th>
                                        <th>Intensidad prom.</th>
                                        <th>Episodios afectados</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {aggregate.topSymptoms.slice(0, 10).map((sym, idx) => (
                                        <tr key={`${sym.name}-${idx}`}>
                                            <td>{sym.name}</td>
                                            <td>{sym.totalCount}</td>
                                            <td>{sym.avgIntensity > 0 ? decimal.format(sym.avgIntensity) : '—'}</td>
                                            <td>{sym.episodesAffected}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
