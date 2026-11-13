import { useEffect, useRef, useState } from 'preact/hooks';
import { sharingStudyId, shareSelection, studies, setSharingStudyId, setShareSelection, markSourceUnavailable } from '../state/store';
import { useFocusTrap } from '../utils/focusTrap';
import { reportUrl } from '@domain/library';

interface ShareDialogProps {
  onReconnect: () => void;
  error: string | null;
  busy: boolean;
  sessionLost: boolean;
}

function getFileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split('/').pop() || 'archivo';
  } catch {
    return 'archivo';
  }
}

function sanitizeFilename(name: string): string {
  // Remove invalid filename characters
  let result = name.replace(/[<>:"\\|?*]/g, '_');
  result = result.replace(/\//g, '_');
  // Remove control characters (0x00-0x1F)
  result = result.split('').filter((ch) => ch.charCodeAt(0) > 0x1F).join('');
  return result.trim();
}

export function ShareDialog({ onReconnect, error, busy, sessionLost }: ShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = sharingStudyId.value;
  const study = studies.value.find((s) => s.id === id);
  const selection = shareSelection.value;

  const [includePdf, setIncludePdf] = useState(false);
  const [includeViewer, setIncludeViewer] = useState(false);
  const [filename, setFilename] = useState('');
  const [filenameError, setFilenameError] = useState('');

  useFocusTrap(dialogRef, Boolean(id));

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (id && !element.open) {
      const s = study;
      if (s) {
        const pdfAvailable = s.hasPdf && !s.pendingAttachment;
        const viewerAvailable = Boolean(s.viewer);
        setIncludePdf(pdfAvailable);
        setIncludeViewer(viewerAvailable && !pdfAvailable);
        const baseName = (pdfAvailable ? s.reportName || s.title : getFileNameFromUrl(s.viewer || '')) || 'estudio';
        setFilename(sanitizeFilename(baseName));
        setShareSelection({
          includePdf: pdfAvailable,
          includeViewer: viewerAvailable && !pdfAvailable,
          filename: sanitizeFilename(baseName),
        });
      }
      element.showModal();
      element.querySelector<HTMLButtonElement>('.quiet')?.focus();
    } else if (!id && element.open) element.close();
  }, [id]);

  useEffect(() => {
    if (selection) {
      setIncludePdf(selection.includePdf);
      setIncludeViewer(selection.includeViewer);
      setFilename(selection.filename);
    }
  }, [selection]);

  const hasShareableContent = study?.hasPdf || study?.viewer || study?.documentIds?.length;

  const handleClose = () => {
    dialogRef.current?.close();
    setSharingStudyId(null);
  };

  const handleCancel = () => {
    handleClose();
  };

  const updateSelection = () => {
    const hasContent = includePdf || includeViewer;
    if (!hasContent) {
      setFilenameError('Seleccioná al menos una fuente para compartir');
      return;
    }
    if (!filename.trim()) {
      setFilenameError('Ingresá un nombre para el archivo');
      return;
    }
    setFilenameError('');
    setShareSelection({ includePdf, includeViewer, filename: filename.trim() });
  };

  const handleConfirm = async () => {
    if (!id || !study) return;
    updateSelection();
    if (filenameError) return;

    const selection = shareSelection.value;
    if (!selection) return;

    const files: File[] = [];
    const urls: string[] = [];

    if (selection.includePdf && study.hasPdf && !study.pendingAttachment) {
      try {
        const response = await fetch(reportUrl(study.id));
        if (response.ok) {
          const blob = await response.blob();
          files.push(new File([blob], `${selection.filename}.pdf`, { type: 'application/pdf' }));
        } else {
          markSourceUnavailable(study.id);
          setFilenameError('No se pudo descargar el PDF. El archivo puede no estar disponible.');
          return;
        }
      } catch {
        setFilenameError('Error de red al descargar el PDF');
        return;
      }
    }

    if (selection.includeViewer && study.viewer) {
      urls.push(study.viewer);
    }

    if (study.documentIds?.length) {
      for (const docId of study.documentIds) {
        const doc = studies.value.find((s) => s.id === docId && s.hasPdf);
        if (doc && !doc.pendingAttachment) {
          try {
            const response = await fetch(reportUrl(docId));
            if (response.ok) {
              const blob = await response.blob();
              files.push(new File([blob], `${doc.reportName || doc.title}.pdf`, { type: 'application/pdf' }));
            }
          } catch {
            // Ignore errors for associated documents
          }
        }
      }
    }

    try {
      const shareData: ShareData & { files?: File[] } = {
        title: study.title,
        text: `Estudio médico: ${study.title} (${study.date})`,
      };
      if (files.length) shareData.files = files;
      if (urls.length) shareData.url = urls[0];

      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else if (navigator.share) {
        await navigator.share(shareData);
      } else {
        throw new Error('El navegador no soporta compartir nativo');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User cancelled the share dialog
      } else if ((err as Error).message.includes('soporta compartir')) {
        setFilenameError('Tu navegador no permite compartir archivos directamente. Usá la opción "Copiar enlace" o descargá el PDF.');
      } else {
        setFilenameError('No se pudo completar el envío. Probá de nuevo o usá otro método.');
      }
      return;
    }

    setFilenameError('');
    handleClose();
  };

  const pdfAvailable = study?.hasPdf && !study?.pendingAttachment;
  const viewerAvailable = Boolean(study?.viewer);

  return (
    <dialog id="share" ref={dialogRef} className="dialog" aria-labelledby="share-title" data-busy={String(busy)}
      onCancel={(event) => { if (busy) event.preventDefault(); else handleCancel(); }}>
      <form id="share-form" onSubmit={(event) => { event.preventDefault(); if (id && !busy) handleConfirm(); }}>
        <div className="dialog-heading">
          <div><h2 id="share-title">Compartir estudio</h2>
            <p id="share-copy">{study ? `«${study.title}»` : ''}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" disabled={busy} onClick={handleCancel}>
            <svg className="icon"><use href="#i-close" /></svg>
          </button>
        </div>
        <p className="form-error" id="share-error" role="alert" hidden={!error && !filenameError}>{error || filenameError}</p>
        <button type="button" className="button secondary reconnect" hidden={!sessionLost} onClick={onReconnect}>Reconectar Google Drive</button>
        <fieldset disabled={busy || sessionLost}>
          <legend>Qué compartir</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pdfAvailable && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
                <input
                  type="checkbox"
                  checked={includePdf}
                  onChange={(e) => { setIncludePdf(e.currentTarget.checked); setFilenameError(''); }}
                  disabled={!pdfAvailable}
                />
                <svg className="icon" style={{ width: 20, height: 20, flex: 'none' }}><use href="#i-file" /></svg>
                <span>Informe PDF ({study?.reportName || study?.title})</span>
              </label>
            )}
            {!pdfAvailable && study?.hasPdf && study?.pendingAttachment && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', opacity: 0.6 }}>
                <input type="checkbox" disabled />
                <svg className="icon" style={{ width: 20, height: 20, flex: 'none' }}><use href="#i-file" /></svg>
                <span>Informe PDF (pendiente de sincronización)</span>
              </label>
            )}
            {viewerAvailable && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
                <input
                  type="checkbox"
                  checked={includeViewer}
                  onChange={(e) => { setIncludeViewer(e.currentTarget.checked); setFilenameError(''); }}
                />
                <svg className="icon" style={{ width: 20, height: 20, flex: 'none' }}><use href="#i-external" /></svg>
                <span>Enlace al visor</span>
              </label>
            )}
            {study?.documentIds?.length && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', opacity: 0.6 }}>
                <input type="checkbox" disabled />
                <svg className="icon" style={{ width: 20, height: 20, flex: 'none' }}><use href="#i-file" /></svg>
                <span>{study.documentIds.length} documento(s) asociado(s) (se incluirán si tienen PDF)</span>
              </label>
            )}
            {!hasShareableContent && (
              <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Este estudio no tiene archivos ni enlaces para compartir</span>
            )}
          </div>
        </fieldset>
        <label style={{ display: 'block', marginTop: '16px' }}>
          Nombre del archivo
          <input
            type="text"
            value={filename}
            onInput={(e) => { setFilename(e.currentTarget.value); setFilenameError(''); }}
            placeholder="ej. ecografia-abdominal-2024-01-15"
            maxLength={120}
            disabled={busy || sessionLost}
          />
          <p className="hint">El nombre se usará para el PDF compartido. No cambia el archivo original.</p>
        </label>
        <div className="dialog-actions">
          <button type="button" className="button quiet" disabled={busy} onClick={handleCancel}>Cancelar</button>
          <button type="submit" className="button primary" id="share-confirm" disabled={busy || sessionLost || !hasShareableContent}>
            {busy ? 'Compartiendo…' : 'Compartir'}
          </button>
        </div>
      </form>
    </dialog>
  );
}