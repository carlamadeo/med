/**
 * Fila individual de un estudio en la lista virtualizada.
 */
import type { Study } from '@domain/models';
import { reportUrl } from '@domain/library';

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return dateStr;
  return new Date(year, month - 1, day).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface StudyRowProps {
  study: Study;
  onEdit: (study: Study) => void;
  onDelete: (study: Study) => void;
  virtualIndex?: number;
  virtualStart?: number;
  measure?: (element: HTMLLIElement | null) => void;
}

export function StudyRow({ study, onEdit, onDelete, virtualIndex, virtualStart, measure }: StudyRowProps) {
  return (
    <li className="record" data-id={study.id} data-index={virtualIndex} ref={measure} style={virtualStart === undefined ? undefined : { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualStart}px)` }}>
      <div className="record-main">
        <span className="file-icon">
          <svg className="icon"><use href="#i-file" /></svg>
        </span>
        <div className="record-text">
          <h3 className="record-title">{study.title}</h3>
          <p className="record-meta">
            <time dateTime={study.date}>{formatDate(study.date)}</time>
            {study.doctor && <span className="record-doctor">{study.doctor}</span>}
            {study.portal && <span className="record-portal">{study.portal}</span>}
          </p>
        </div>
        <div className="type-badges" aria-label="Tipos de estudio">
          {study.types.map(type => (
            <span key={type} className="type-badge">{type}</span>
          ))}
        </div>
      </div>
      <div className="record-controls">
        <div className="record-links">
          {study.hasPdf ? (
            <a className="record-link pdf-link" href={reportUrl(study.id)} target="_blank" rel="noopener noreferrer">
              <svg className="icon"><use href="#i-file" /></svg> Informe PDF
            </a>
          ) : null}
          {study.viewer ? (
            <a className="record-link viewer-link" href={study.viewer} target="_blank" rel="noopener noreferrer">
              <svg className="icon"><use href="#i-external" /></svg> Abrir visor
            </a>
          ) : null}
          {!study.hasPdf && !study.viewer && <span className="no-attachment">Sin archivos adjuntos</span>}
        </div>
        <div className="record-actions">
          <button
            className="icon-button edit"
            type="button"
            aria-label={`Editar ${study.title}`}
            title={`Editar ${study.title}`}
            onClick={() => onEdit(study)}
          >
            <svg className="icon"><use href="#i-edit" /></svg>
          </button>
          <button
            className="icon-button remove"
            type="button"
            aria-label={`Eliminar ${study.title}`}
            title={`Eliminar ${study.title}`}
            onClick={() => onDelete(study)}
          >
            <svg className="icon"><use href="#i-trash" /></svg>
          </button>
        </div>
      </div>
    </li>
  );
}
