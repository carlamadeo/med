import { useEffect, useRef, useState } from 'preact/hooks';
import { exporting, exportScope, exportError, setExporting, setExportScope, setExportError, filteredStudies, visibleStudies, operations, portals, medicalEvents } from '../state/store';
import { useFocusTrap } from '../utils/focusTrap';
import { reportUrl } from '@domain/library';
import type { Study } from '@domain/models';

interface ExportDialogProps {
  onReconnect: () => void;
  error: string | null;
  sessionLost: boolean;
}

function formatDateForFilename(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function fetchPdfFile(fileId: string): Promise<File | null> {
  try {
    const response = await fetch(reportUrl(fileId));
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], `${fileId}.pdf`, { type: 'application/pdf' });
  } catch {
    return null;
  }
}

export function ExportDialog({ onReconnect, error, sessionLost }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isExporting = exporting.value;
  const scope = exportScope.value;
  const expError = exportError.value;

  const [includePdfs, setIncludePdfs] = useState(true);
  const [includeViewerLinks, setIncludeViewerLinks] = useState(true);
  const [filename, setFilename] = useState(`mis-estudios-${formatDateForFilename()}.zip`);

  useFocusTrap(dialogRef, isExporting);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (isExporting && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>('.quiet')?.focus();
    } else if (!isExporting && element.open) element.close();
  }, [isExporting]);

  const handleClose = () => {
    dialogRef.current?.close();
    setExporting(false);
    setExportError(null);
  };

  const handleCancel = () => {
    handleClose();
  };

  const handleScopeChange = (newScope: 'all' | 'filtered') => {
    setExportScope(newScope);
  };

  const getStudiesToExport = () => {
    return scope === 'filtered' ? filteredStudies.value : visibleStudies.value;
  };

  const handleConfirm = async () => {
    setExportError(null);

    const studiesToExport = getStudiesToExport();
    if (studiesToExport.length === 0) {
      setExportError('No hay estudios para exportar');
      return;
    }

    const selectedStudies = studiesToExport.filter(s => !s.syncStatus);
    if (selectedStudies.length !== studiesToExport.length) {
      setExportError('No se pueden exportar estudios con cambios pendientes');
      return;
    }

    try {
      const zip = await createExportZip(selectedStudies, includePdfs, includeViewerLinks);
      downloadBlob(zip, filename);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Error al crear la exportación');
      return;
    }

    handleClose();
  };

  const hasStudies = getStudiesToExport().length > 0;

  return (
    <dialog id="export" ref={dialogRef} className="dialog" aria-labelledby="export-title" data-busy={String(isExporting)}
      onCancel={(event) => { if (isExporting) event.preventDefault(); else handleCancel(); }}>
      <form id="export-form" onSubmit={(event) => { event.preventDefault(); if (!isExporting) handleConfirm(); }}>
        <div className="dialog-heading">
          <div><h2 id="export-title">Exportar historia</h2>
            <p id="export-copy">Descargá una copia portable de tus registros</p>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" disabled={isExporting} onClick={handleCancel}>
            <svg className="icon"><use href="#i-close" /></svg>
          </button>
        </div>
        <p className="form-error" id="export-error" role="alert" hidden={!error && !expError}>{error || expError}</p>
        <button type="button" className="button secondary reconnect" hidden={!sessionLost} onClick={onReconnect}>Reconectar Google Drive</button>
        <fieldset disabled={isExporting || sessionLost}>
          <legend>Qué exportar</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
              <input
                type="radio"
                name="export-scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => handleScopeChange('all')}
              />
              <span>Todos los estudios ({visibleStudies.value.length})</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
              <input
                type="radio"
                name="export-scope"
                value="filtered"
                checked={scope === 'filtered'}
                onChange={() => handleScopeChange('filtered')}
              />
              <span>Solo los filtrados ({filteredStudies.value.length})</span>
            </label>
          </div>
        </fieldset>
        <fieldset disabled={isExporting || sessionLost}>
          <legend>Contenido a incluir</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
              <input
                type="checkbox"
                checked={includePdfs}
                onChange={(e) => setIncludePdfs(e.currentTarget.checked)}
              />
              <svg className="icon" style={{ width: 20, height: 20, flex: 'none' }}><use href="#i-file" /></svg>
              <span>Archivos PDF</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
              <input
                type="checkbox"
                checked={includeViewerLinks}
                onChange={(e) => setIncludeViewerLinks(e.currentTarget.checked)}
              />
              <svg className="icon" style={{ width: 20, height: 20, flex: 'none' }}><use href="#i-external" /></svg>
              <span>Enlaces a visores</span>
            </label>
          </div>
        </fieldset>
        <label style={{ display: 'block', marginTop: '16px' }}>
          Nombre del archivo
          <input
            type="text"
            value={filename}
            onInput={(e) => setFilename(e.currentTarget.value)}
            placeholder="mis-estudios-2024-01-15.zip"
            maxLength={120}
            disabled={isExporting || sessionLost}
          />
          <p className="hint">La exportación se descargará como un archivo ZIP</p>
        </label>
        <div className="dialog-actions">
          <button type="button" className="button quiet" disabled={isExporting} onClick={handleCancel}>Cancelar</button>
          <button type="submit" className="button primary" id="export-confirm" disabled={isExporting || sessionLost || !hasStudies}>
            {isExporting ? 'Exportando…' : 'Exportar'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

async function createExportZip(studiesToExport: Study[], includePdfs: boolean, includeViewerLinks: boolean): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const manifest = {
    exportedAt: new Date().toISOString(),
    totalStudies: studiesToExport.length,
    studies: studiesToExport.map(s => ({
      id: s.id,
      title: s.title,
      date: s.date,
      types: s.types,
      doctor: s.doctor,
      portal: s.portal,
      viewer: s.viewer,
      reportName: s.reportName,
      hasPdf: s.hasPdf,
      operationId: s.operationId,
      documentIds: s.documentIds,
    }))
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const pdfsFolder = includePdfs ? zip.folder('pdfs') : null;
  const viewerLinks: string[] = [];

  for (const study of studiesToExport) {
    if (includePdfs && study.hasPdf && pdfsFolder) {
      const pdfFile = await fetchPdfFile(study.driveFileId);
      if (pdfFile) {
        const safeName = study.reportName || study.title || `estudio-${study.id}`;
        pdfsFolder.file(`${safeName}.pdf`, pdfFile);
      }
    }

    if (includeViewerLinks && study.viewer) {
      viewerLinks.push(`${study.title} (${study.date}): ${study.viewer}`);
    }
  }

  if (includeViewerLinks && viewerLinks.length > 0) {
    zip.file('viewer-links.txt', viewerLinks.join('\n\n'));
  }

  const operationsList = operations.value.map(op => ({
    id: op.id,
    name: op.name,
    date: op.date,
    surgeon: op.surgeon,
    institution: op.institution,
    type: op.type,
    notes: op.notes,
    studyIds: op.studyIds,
  }));
  zip.file('operations.json', JSON.stringify(operationsList, null, 2));

  const portalsList = portals.value.map(p => ({
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    url: p.url,
    notes: p.notes,
  }));
  zip.file('portals.json', JSON.stringify(portalsList, null, 2));

  const eventsList = medicalEvents.value.map(e => ({
    id: e.id,
    kind: e.kind,
    date: e.date,
    doctor: e.doctor,
    notes: e.notes,
    studyIds: e.studyIds,
    documentIds: e.documentIds,
  }));
  zip.file('medical-events.json', JSON.stringify(eventsList, null, 2));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}