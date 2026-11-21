import {useMemo, useState} from 'preact/hooks';
import {formatStudyDate} from '@domain/library';
import {computeEpisodesAggregate, formatMonth, shortMonth, type Period} from '@domain/episodes-aggregate';
import type {Episode} from '@domain/models';

interface EpisodesSummaryProps {
    episodes: readonly Episode[];
    initialPeriod?: Period;
}

export function EpisodesSummary({episodes, initialPeriod = '12months'}: EpisodesSummaryProps) {
    const [period, setPeriod] = useState<Period>(initialPeriod);
    const [expanded, setExpanded] = useState(false);

    const aggregate = useMemo(() => computeEpisodesAggregate(episodes, period), [episodes, period]);

    if (aggregate.totalEpisodes === 0) {
        return (
            <div className="episodes-summary empty">
                <p className="summary-empty">No hay episodios para mostrar estadísticas.</p>
            </div>
        );
    }

    const severityHighCount = aggregate.severityDistribution.high;
    const mostFrequentIllness = aggregate.mostFrequentIllness || '—';

    return (
        <section className="episodes-summary" aria-labelledby="episodes-summary-title">
            <header className="summary-header">
                <h3 id="episodes-summary-title">Resumen de episodios</h3>
                <div className="summary-tabs" role="tablist" aria-label="Período">
                    <button
                        role="tab"
                        aria-selected={period === 'year'}
                        className={`summary-tab ${period === 'year' ? 'active' : ''}`}
                        onClick={() => setPeriod('year')}
                    >
                        Año actual
                    </button>
                    <button
                        role="tab"
                        aria-selected={period === '12months'}
                        className={`summary-tab ${period === '12months' ? 'active' : ''}`}
                        onClick={() => setPeriod('12months')}
                    >
                        12 meses
                    </button>
                    <button
                        role="tab"
                        aria-selected={period === 'all'}
                        className={`summary-tab ${period === 'all' ? 'active' : ''}`}
                        onClick={() => setPeriod('all')}
                    >
                        Todo el tiempo
                    </button>
                </div>
            </header>

            <div className="summary-kpis">
                <div className="kpi">
                    <span className="summary-kpi-value">{aggregate.totalEpisodes}</span>
                    <span className="summary-kpi-label">Episodios</span>
                </div>
                <div className="kpi">
                    <span className="summary-kpi-value">{aggregate.totalDaysIll}</span>
                    <span className="summary-kpi-label">Días enfermo</span>
                </div>
                <div className="kpi">
                    <span className="summary-kpi-value">{aggregate.avgDuration.toFixed(1)}</span>
                    <span className="summary-kpi-label">Días/episodio</span>
                </div>
                <div className="kpi">
                    <span className="summary-kpi-value">{mostFrequentIllness}</span>
                    <span className="summary-kpi-label">Más frecuente</span>
                </div>
                <div className={`kpi severity-${severityHighCount > 0 ? 'high' : severityHighCount === 0 && aggregate.severityDistribution.medium > 0 ? 'medium' : 'low'}`}>
                    <span className="summary-kpi-value">{severityHighCount > 0 ? 'Alta' : aggregate.severityDistribution.medium > 0 ? 'Media' : 'Baja'}</span>
                    <span className="summary-kpi-label">Severidad top</span>
                </div>
            </div>

            <div className="summary-grids">
                <div className="summary-section">
                    <h4>Frecuencia mensual</h4>
                    <div className="monthly-heatmap" role="img" aria-label={`Días enfermo por mes, ${period === 'year' ? 'año actual' : period === '12months' ? 'últimos 12 meses' : 'historial completo'}`}>
                        {aggregate.monthlyFrequency.map(m => (
                            <div
                                key={m.month}
                                className="heatmap-cell"
                                style={{
                                    '--intensity': Math.min(m.days / 14, 1),
                                    backgroundColor: m.days > 0
                                        ? `hsl(var(--heatmap-hue, 10), var(--heatmap-sat, 70%), calc(95% - var(--intensity) * 70%))`
                                        : 'var(--color-surface-2)',
                                }}
                                title={`${formatMonth(m.month)}: ${m.count} episodio${m.count !== 1 ? 's' : ''}, ${m.days} día${m.days !== 1 ? 's' : ''}`}
                            >
                                <span className="cell-label">{shortMonth(m.month)}</span>
                                {m.days > 0 && <span className="cell-value">{m.days}d</span>}
                            </div>
                        ))}
                    </div>
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
                                        <td>
                                            <span className={`illness-name severity-${ill.severity}`}>{ill.illness}</span>
                                        </td>
                                        <td>{ill.count}</td>
                                        <td>{ill.totalDays}</td>
                                        <td>{ill.avgDuration.toFixed(1)}</td>
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
                                    <span className="symptom-intensity">{sym.avgIntensity.toFixed(1)}</span>
                                )}
                            </span>
                        ))}
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
                        {aggregate.topMedications.length === 0 && <span className="no-data">—</span>}
                    </div>
                </div>
            </div>

            <button
                className="summary-expand"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
            >
                {expanded ? '▲ Ocultar análisis completo' : '▼ Ver análisis completo'}
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
                        <div className="summary-table full">
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
                                            <td><span className={`illness-name severity-${ill.severity}`}>{ill.illness}</span></td>
                                            <td>{ill.count}</td>
                                            <td>{ill.totalDays}</td>
                                            <td>{ill.avgDuration.toFixed(1)}</td>
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
                                            <td>{sym.avgIntensity > 0 ? sym.avgIntensity.toFixed(1) : '—'}</td>
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