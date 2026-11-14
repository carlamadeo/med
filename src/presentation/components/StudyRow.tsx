/**
 * Fila individual de un estudio en la lista virtualizada.
 */
import type { Study } from '@domain/models';
import { formatStudyDate, reportUrl } from '@domain/library';
import { studies, isSourceUnavailable, offline } from '../state/store';



interface StudyRowProps {
  study: Study;
  onEdit: (study: Study) => void;
  onDelete: (study: Study) => void;
  onShare: (study: Study) => void;
  virtualIndex?: number;
  virtualStart?: number;
  measure?: (element: HTMLLIElement | null) => void;
  monthLabel?: string;
}

function UnavailableSource({ label }: { label: string }) {
  return (
    <span className="record-link unavailable">
      <svg className="icon"><use href="#i-file" /></svg>
      <span className="unavailable-icon" aria-hidden="true">⚠</span>
      {label} (no disponible)
    </span>
  );
}

export function StudyRow({ study, onEdit, onDelete, onShare, virtualIndex, virtualStart, measure, monthLabel }: StudyRowProps) {
  const pdfUnavailable = study.hasPdf && isSourceUnavailable(study.driveFileId);
  const viewerUnavailable = study.viewer && isSourceUnavailable(study.viewer);
  const isOffline = offline.value;

  function OnlineIndicator() {
    return isOffline ? <span className="online-indicator" aria-label="Requiere conexión">⟳</span> : null;
  }

  return (
    <li className="record" data-id={study.id} data-index={virtualIndex} tabIndex={0} ref={measure} style={virtualStart === undefined ? undefined : { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualStart}px)` }}>
      {monthLabel && <p className="month-heading">{monthLabel}</p>}
      <div className="record-main">
        <span className="file-icon">
          <svg className="icon"><use href="#i-file" /></svg>
        </span>
        <div className="record-text">
          <h3 className="record-title">{study.title}</h3>
          {study.syncStatus && <p>{study.syncStatus === 'conflict' ? 'Requiere revisión' : study.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}</p>}
          <p className="record-meta">
            <time dateTime={study.date}>{formatStudyDate(study.date)}</time>
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
            pdfUnavailable ? (
              <UnavailableSource label="Informe PDF" />
            ) : (
              <a className="record-link pdf-link" href={reportUrl(study.id)} target="_blank" rel="noopener noreferrer">
                <svg className="icon"><use href="#i-file" /></svg> Informe PDF <OnlineIndicator />
              </a>
            )
          ) : null}
          {study.pendingAttachment && <span>PDF pendiente de sincronización</span>}
          {study.documentIds?.map((id) => {
            const source = studies.value.find((item) => item.id === id && item.hasPdf);
            const idUnavailable = isSourceUnavailable(id);
            return source ? (
              idUnavailable ? (
                <UnavailableSource key={id} label={`PDF asociado: ${source.reportName || source.title}`} />
              ) : (
                <a key={id} className="record-link" href={reportUrl(id)} target="_blank" rel="noopener noreferrer">PDF asociado: {source.reportName || source.title} <OnlineIndicator /></a>
              )
            ) : (
              <span key={id}>Documento asociado no disponible</span>
            );
          })}
          {study.viewer ? (
            viewerUnavailable ? (
              <UnavailableSource label="Abrir visor" />
            ) : (
              <a className="record-link viewer-link" href={study.viewer} target="_blank" rel="noopener noreferrer">
                <svg className="icon"><use href="#i-external" /></svg> Abrir visor <OnlineIndicator />
              </a>
            )
          ) : null}
          {!study.hasPdf && !study.pendingAttachment && !study.documentIds?.length && !study.viewer && <span className="no-attachment">Sin archivos adjuntos</span>}
        </div>
        <div className="record-actions">
          <button
            disabled={Boolean(study.syncStatus)}
            className="icon-button edit"
            type="button"
            aria-label={`Editar ${study.title}`}
            title={`Editar ${study.title}`}
            onClick={() => onEdit(study)}
          >
            <svg className="icon"><use href="#i-edit" /></svg>
          </button>
          <button
            disabled={Boolean(study.syncStatus)}
            className="icon-button remove"
            type="button"
            aria-label={`Eliminar ${study.title}`}
            title={`Eliminar ${study.title}`}
            onClick={() => onDelete(study)}
          >
            <svg className="icon"><use href="#i-trash" /></svg>
          </button>
          {(study.hasPdf || study.pendingAttachment || study.documentIds?.length || study.viewer) && (
            <button
              className="icon-button print"
              type="button"
              aria-label={`Imprimir ${study.title}`}
              title={`Imprimir ${study.title}`}
              onClick={() => window.print()}
            >
              <svg className="icon"><use href="#i-print" /></svg>
            </button>
          )}
          {(study.hasPdf || study.viewer || study.documentIds?.length) && !study.syncStatus && (
            <button
              className="icon-button share"
              type="button"
              aria-label={`Compartir ${study.title}`}
              title={`Compartir ${study.title}`}
              onClick={() => onShare(study)}
            >
              <svg className="icon"><use href="#i-share" /></svg>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
