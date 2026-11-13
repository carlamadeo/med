/**
 * Diálogo de editor: crear o editar un estudio.
 * Incluye la lectura automática de PDF (pdf.js + OCR) con aborte y timeout.
 */
import { useEditor } from '../hooks/useEditor';
import { useFocusTrap } from '../utils/focusTrap';
import { portalNames } from '@domain/library';
import { todayLocal } from '@domain/utils';
import {
  editingStudy,
  studies,
  operations,
  isEditorOpen,
} from '../state/store';

import type { StudyDraft } from '@domain/models';

interface EditorDialogProps {
  onClose: () => void;
  error: string | null;
  busy: boolean;
  availableTypes: string[];
  onSave: (draft: StudyDraft) => Promise<void>;
  verifyOwner: () => Promise<boolean>;
  sessionLost?: boolean;
  onReconnect?: () => void;
}

export function EditorDialog({
  onClose,
  error,
  busy,
  availableTypes,
  onSave,
  verifyOwner,
  sessionLost = false,
  onReconnect,
}: EditorDialogProps) {
  const study = editingStudy.value;
  const isEdit = !!study;

  const {
    dialogRef,
    formRef,
    reportInputRef,
    title,
    setTitle,
    date,
    setDate,
    doctor,
    setDoctor,
    portal,
    setPortal,
    viewer,
    setViewer,
    types,
    reading,
    progress,
    removeReport,
    setRemoveReport,
    reportName,
    selectedReport,
    checkingReport,
    candidates,
    operationId,
    setOperationId,
    documentIds,
    setDocumentIds,
    creatingOperation,
    setCreatingOperation,
    operationBusy,
    operationError,
    setOperationError,
    handleReportChange,
    handleTypeChange,
    createOperation,
    handleClose,
    cancelAnalysis,
    handleSubmit,
    applySuggestion,
    discardSuggestion,
    resetForm,
  } = useEditor({
    study,
    onSave,
    verifyOwner,
    sessionLost,
    onClose,
  });

  useFocusTrap(dialogRef, isEditorOpen.value);

  return (
    <dialog
      id="editor"
      ref={dialogRef}
      className="dialog editor"
      aria-labelledby={sessionLost ? 'editor-session-title' : 'editor-title'}
      data-busy={busy ? 'true' : 'false'}
      onCancel={(event) => { if (busy || operationBusy) event.preventDefault(); }}
    >
      <form ref={formRef} id="editor-form" onInput={(event) => {
        const name = (event.target as HTMLInputElement).name;
        if (name === 'date' || name === 'types' || name === 'doctor' || name === 'title') {
          // suggested.current.delete(name) - handled by hook
        }
      }} onSubmit={handleSubmit}>
      <fieldset hidden={sessionLost} disabled={busy || operationBusy || sessionLost} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="dialog-heading">
        <div>
          <h2 id="editor-title">{isEdit ? 'Editar estudio' : 'Agregar estudio'}</h2>
          <p>Adjuntá un PDF para sugerir los datos o completalos manualmente.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          data-close
          aria-label="Cerrar"
          onClick={handleClose}
        >
          <svg className="icon"><use href="#i-close" /></svg>
        </button>
      </div>

      <div className="attachments report-upload">
        <label>
          Informe en PDF <small>Opcional · hasta 20 MB</small>
          <input
            ref={reportInputRef}
            name="report"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleReportChange}
          />
        </label>
        {selectedReport && <div id="selected-report">
          <p>{selectedReport.name} · {selectedReport.size.toLocaleString('es-AR')} bytes · {checkingReport ? 'Validando archivo' : 'Listo para revisar · todavía sin guardar'}</p>
          <button type="button" className="button quiet" data-remove-selected-report onClick={resetForm}>Quitar archivo seleccionado</button>
        </div>}
        <p id="detection" className="hint" role="status" data-state="">Buscamos la fecha, los tipos y el médico en el PDF.</p>
        {Object.keys(candidates).length > 0 && <section id="extraction-suggestions" aria-label="Sugerencias de lectura">
          <p>Estas sugerencias no se guardan hasta que las aceptes.</p>
          {(['date', 'types', 'doctor', 'title'] as const).map((name) => {
            const value = candidates[name];
            if (!value) return null;
            const label = { date: 'Fecha', types: 'Tipos', doctor: 'Médico', title: 'Título' }[name];
            return <div key={name}>
              <span>{label}: {Array.isArray(value) ? value.join(', ') : value}</span>
              <button type="button" data-accept-suggestion={name} onClick={() => applySuggestion(name, value)}>Aceptar {label.toLowerCase()}</button>
              <button type="button" onClick={() => discardSuggestion(name)}>Descartar {label.toLowerCase()}</button>
            </div>;
          })}
        </section>}
        {reading && (
          <div className="analysis-progress" aria-busy="true">
            <progress max="100" value={progress ?? undefined} aria-label="Progreso de lectura del PDF" />
            <button type="button" className="secondary" data-cancel-analysis disabled={checkingReport} onClick={cancelAnalysis}>Cancelar lectura</button>
          </div>
        )}
        {reportName && (
          <div id="current-report">
            <span id="current-report-name">{reportName}</span>
            <label className="checkbox">
              <input name="removeReport" type="checkbox" checked={removeReport} onChange={() => setRemoveReport(!removeReport)} />
              Quitar PDF actual
            </label>
          </div>
        )}
      </div>

      {(documentIds.length > 0 || studies.value.some((item) => item.hasPdf && item.id !== study?.id)) && <fieldset>
        <legend>Documentos de otros estudios</legend>
        <p className="hint">Vinculá documentos existentes sin crear otra copia.</p>
        {studies.value.filter((item) => item.hasPdf && item.id !== study?.id).map((item) => <label key={item.id}>
          <input type="checkbox" name="documentIds" value={item.id} checked={documentIds.includes(item.id)} onChange={(event) => {
            const checked = event.currentTarget.checked;
            setDocumentIds((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id));
          }} /> {item.reportName || item.title} · {item.title}
        </label>)}
        {documentIds.filter((id) => !studies.value.some((item) => item.id === id && item.hasPdf)).map((id) => <label key={id}>
          <input type="checkbox" name="documentIds" value={id} checked onChange={() => setDocumentIds((current) => current.filter((item) => item !== id))} /> Documento no disponible
        </label>)}
      </fieldset>}

      <label>
        Nombre del estudio
        <input
          id="editor-title-field"
          name="title"
          value={title}
          onInput={(e: Event) => { setTitle((e.currentTarget as HTMLInputElement).value); }}
          maxLength={160}
          placeholder="Ej. Ecografía abdominal"
          required
        />
      </label>
      <label>
        Fecha del estudio
        <input
          id="editor-date-field"
          name="date"
          type="date"
          value={date}
          onInput={(e: Event) => { setDate((e.currentTarget as HTMLInputElement).value); }}
          min="1900-01-01"
          max={todayLocal()}
          required
        />
      </label>
      <fieldset id="study-types" className="study-types" aria-describedby="types-hint">
        <legend>Tipos de estudio</legend>
        <p className="hint" id="types-hint">Elegí uno o varios.</p>
        <div className="type-options">
          {availableTypes.map(t => (
            <label key={t} className="type-option">
              <input
                type="checkbox"
                name="types"
                value={t}
                checked={types.includes(t)}
                onInput={handleTypeChange}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="two">
        <label>
          Médico o profesional <small>Opcional</small>
          <input
            name="doctor"
            value={doctor}
            onInput={(e: Event) => { setDoctor((e.currentTarget as HTMLInputElement).value); }}
            maxLength={120}
            placeholder="Ej. Dra. Ana Pérez"
          />
        </label>
        <div className="portal-field">
          <label>
            Portal o institución <small>Opcional</small>
            <input
              name="portal"
              value={portal}
              onInput={(e: Event) => setPortal((e.currentTarget as HTMLInputElement).value)}
              maxLength={120}
              placeholder="Escribí o elegí una institución"
              autocomplete="off"
              aria-describedby="portal-hint"
            />
          </label>
          <details id="portal-choices" hidden={!portalNames(studies.value).length}>
            <summary>Instituciones utilizadas</summary>
            <ul id="portal-options">{portalNames(studies.value).map(name => <li key={name}>
              <button type="button" onClick={(event) => {
                setPortal(name);
                const input = formRef.current?.querySelector<HTMLInputElement>('[name="portal"]');
                if (input) { input.value = name; input.focus(); }
                const details = event.currentTarget.closest('details');
                if (details) details.open = false;
              }}>{name}</button>
            </li>)}</ul>
          </details>
        </div>
      </div>
      <p className="hint" id="portal-hint">Podés elegir una institución que ya usaste o escribir una nueva. Se recuerda al guardar el estudio.</p>
      <label>Operación <small>Opcional</small>
        <select id="operation-id" name="operationId" value={operationId} onChange={(event) => setOperationId(event.currentTarget.value)}>
          <option value="">Sin operación</option>
          {operations.value.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
        </select>
      </label>
      <button id="create-operation" type="button" className="button quiet" onClick={() => { setCreatingOperation(!creatingOperation); setOperationError(''); }}>Crear operación nueva</button>
      {creatingOperation && <fieldset disabled={operationBusy}>
        <legend>Nueva operación</legend>
        <label>Nombre <input id="new-operation-name" name="newOperationName" maxLength={120} /></label>
        <label>Fecha <input name="newOperationDate" type="date" /></label>
        <label>Cirujano <input name="newOperationSurgeon" /></label>
        <label>Institución <input name="newOperationInstitution" /></label>
        <label>Intervención <input name="newOperationType" /></label>
        <label>Notas <textarea name="newOperationNotes" /></label>
        {operationError && <p role="alert">{operationError}</p>}
        <button type="button" id="save-new-operation" onClick={() => void createOperation()}>{operationBusy ? 'Guardando…' : 'Guardar operación'}</button>
        <button type="button" onClick={() => setCreatingOperation(false)}>Cancelar</button>
      </fieldset>}
      <div className="attachments">
        <label>
          Enlace al visor <small>Opcional</small>
          <input
            name="viewer"
            type="url"
            inputmode="url"
            value={viewer}
            onInput={(e: Event) => setViewer((e.currentTarget as HTMLInputElement).value)}
            maxLength={5000}
            placeholder="https://…"
          />
        </label>
        <p className="hint">El visor se abre en el portal original. Puede pedirte que inicies sesión.</p>
      </div>
      </fieldset>
      {sessionLost && <h2 id="editor-session-title">Sesión desconectada</h2>}
      <p className="form-error" id="form-error" role="alert" hidden={!error}>{error}</p>
      <button type="button" className="button secondary reconnect" hidden={!sessionLost} onClick={onReconnect}>Reconectar Google Drive</button>
      <div className="dialog-actions">
        <button type="button" className="button quiet" data-close onClick={handleClose}>
          Cancelar
        </button>
        <button type="submit" className="button primary" id="save" disabled={busy || sessionLost || checkingReport}>
          {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Guardar estudio')}
        </button>
      </div>
      </form>
    </dialog>
  );
}
