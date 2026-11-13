/**
 * Diálogo de editor: crear o editar un estudio.
 * Incluye la lectura automática de PDF (pdf.js + OCR) con aborte y timeout.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { analyzePdf, validatePdf } from '@data/pdf-analysis';
import { driveOperationRepo } from '@data';
import type { StudyDraft } from '@domain/models';
import { portalNames } from '@domain/library';
import { useFocusTrap } from '../utils/focusTrap';
import {
  editingStudy,
  studies,
  operations,
  isEditorOpen,
  setEditorOpen,
} from '../state/store';

const ANALYSIS_TIMEOUT_MS = 45_000;

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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [title, setTitle] = useState<string>(study?.title ?? '');
  const [date, setDate] = useState<string>(study?.date ?? '');
  const [doctor, setDoctor] = useState<string>(study?.doctor ?? '');
  const [portal, setPortal] = useState<string>(study?.portal ?? '');
  const [viewer, setViewer] = useState<string>(study?.viewer ?? '');
  const [types, setTypes] = useState<string[]>(study?.types ?? []);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [removeReport, setRemoveReport] = useState(false);
  const [reportName, setReportName] = useState(study?.reportName ?? '');
  const [operationId, setOperationId] = useState(study?.operationId ?? '');
  const [creatingOperation, setCreatingOperation] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const editorGeneration = useRef(0);

  // Focus trap for accessibility
  useFocusTrap(dialogRef, isEditorOpen.value);

  const setStatus = (value: string) => { const el = formRef.current?.querySelector<HTMLElement>('#detection'); if (el) el.textContent = value; };
  const setStatusState = (value: string) => { const el = formRef.current?.querySelector<HTMLElement>('#detection'); if (el) el.dataset.state = value; };

  const reportInputRef = useRef<HTMLInputElement | null>(null);
  const analysisCtrl = useRef<AbortController | null>(null);
  const analysisTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportFileRef = useRef<File | null>(null);

  const touched = useRef<Set<'date' | 'types' | 'doctor' | 'title'>>(new Set());
  const suggested = useRef<Map<'date' | 'types' | 'doctor' | 'title', string>>(new Map());

  useEffect(() => {
    if (sessionLost) {
      editorGeneration.current += 1;
      analysisCtrl.current?.abort();
      if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
      setReading(false);
      setProgress(null);
    }
  }, [sessionLost]);

  // Open/close dialog imperatively - subscribe to signal directly
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleOpenChange = () => {
      if (isEditorOpen.value) {
        if (dialog.open) return;
        const current = editingStudy.value;
        editorGeneration.current += 1;
        setCreatingOperation(false);
        setOperationError('');
        setOperationId(current?.operationId ?? '');
        if (!dialog.open) dialog.showModal();
        (current ? formRef.current?.querySelector<HTMLInputElement>('[name=title]') : reportInputRef.current)?.focus();
        // Reset DOM values immediately, before a user can choose a new file or type.
        for (const input of formRef.current?.querySelectorAll<HTMLInputElement>('[name=types]') ?? []) input.checked = current?.types.includes(input.value) ?? false;
        for (const name of ['title', 'date', 'doctor', 'portal', 'viewer'] as const) {
          const input = formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`);
          if (input) input.value = current?.[name] ?? '';
        }
        setTitle(current?.title ?? '');
        setDate(current?.date ?? '');
        setDoctor(current?.doctor ?? '');
        setPortal(current?.portal ?? '');
        setViewer(current?.viewer ?? '');
        const operation = formRef.current?.querySelector<HTMLSelectElement>('#operation-id');
        if (operation) operation.value = current?.operationId ?? '';
        setTypes(current?.types ?? []);
        reportFileRef.current = null;
        if (reportInputRef.current) reportInputRef.current.value = '';
        formRef.current?.querySelector<HTMLInputElement>('[name=types]')?.setCustomValidity('');
        setRemoveReport(false);
        setReportName(current?.reportName ?? '');
        setStatus('Buscamos la fecha, los tipos y el médico en el PDF.');
        setStatusState('');
        touched.current = new Set();
        suggested.current = new Map();
      } else {
        dialog.close();
      }
    };

    // Subscribe to signal changes
    const closed = () => { editorGeneration.current += 1; analysisCtrl.current?.abort(); setEditorOpen(false); };
    const markTouched = (event: Event) => {
      const name = (event.target as HTMLInputElement).name;
      if (name === 'date' || name === 'types' || name === 'doctor' || name === 'title') { touched.current.add(name); suggested.current.delete(name); }
    };
    formRef.current?.addEventListener('input', markTouched, true);
    dialog.addEventListener('close', closed);
    const unsubscribe = isEditorOpen.subscribe(handleOpenChange);
    


    return () => {
      unsubscribe();
      formRef.current?.removeEventListener('input', markTouched, true);
      dialog.removeEventListener('close', closed);
      dialog.close();
    };
  }, []);

  const handleClose = () => {
    analysisCtrl.current?.abort();
    dialogRef.current?.close();
    setEditorOpen(false);
    onClose();
  };

  const fieldValue = (name: 'date' | 'types' | 'doctor' | 'title'): string | string[] => {
    if (name === 'types') return [...(formRef.current?.querySelectorAll<HTMLInputElement>('[name="types"]:checked') ?? [])].map(input => input.value);
    return formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '';
  };

  const setFieldValue = (name: 'date' | 'types' | 'doctor' | 'title', value: string | string[]): void => {
    if (name === 'types') {
      for (const input of formRef.current?.querySelectorAll<HTMLInputElement>('[name="types"]') ?? []) input.checked = value.includes(input.value);
      setTypes(value as string[]);
    } else {
      const input = formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (input) input.value = String(value);
      if (name === 'date') setDate(String(value));
      else if (name === 'doctor') setDoctor(String(value));
      else setTitle(String(value));
    }
  };

  const isEmpty = (name: 'date' | 'types' | 'doctor' | 'title'): boolean => {
    return fieldValue(name).length === 0;
  };

  const handleReportChange = async (_e: Event) => {
    analysisCtrl.current?.abort();
    setReading(false);
    setProgress(null);
    for (const [name, value] of suggested.current) {
      if (JSON.stringify(fieldValue(name)) === value) {
        setFieldValue(name, name === 'types' ? [] : '');
      }
    }
    suggested.current = new Map();

    const file = reportInputRef.current?.files?.[0] ?? null;
    reportFileRef.current = file;

    if (!file) {
      setStatus('Podés adjuntar un PDF o completar la ficha manualmente.');
      return;
    }

    const controller = new AbortController();
    analysisCtrl.current = controller;
    setReading(true);
    const { signal } = controller;
    const active = () => isEditorOpen.value && analysisCtrl.current === controller && !signal.aborted;

    analysisTimeout.current = setTimeout(() => {
      if (active()) {
        controller.abort();
        setReading(false);
        setStatus('La lectura tardó demasiado. Podés completar los campos y guardar el PDF.');
      }
    }, ANALYSIS_TIMEOUT_MS);

    setStatusState('');
    const detection = formRef.current?.querySelector<HTMLElement>('#detection');
    if (detection) detection.dataset.state = '';
    setStatus('Leyendo el informe…');

    try {
      await validatePdf(file);
    } catch (err) {
      clearTimeout(analysisTimeout.current!);
      if (active()) {
        if (reportInputRef.current) reportInputRef.current.value = '';
        setStatus(err instanceof Error ? err.message : 'Elegí un archivo PDF válido.');
        setStatusState('error');
        setReading(false);
      }
      return;
    }

    try {
      const found = await analyzePdf(file, signal, () => {
        if (active()) {
          setStatus('Leyendo el texto de una imagen. Puede demorar unos segundos…');
        }
      }, (event) => {
        if (!active()) return;
        setStatus(`${event.stage === 'ocr' ? 'Analizando imagen' : 'Leyendo página'} ${event.page} de ${event.total}…`);
        setProgress(Math.round(event.progress * 100));
      });
      if (!active()) return;

      const detected: Record<string, string | string[]> = { ...(found as Record<string, string | string[]>) };
      if (found.types?.length) {
        detected.title = new Intl.ListFormat('es').format(
          found.types.map((t, i) => (i && t !== t.toUpperCase() ? t[0]!.toLowerCase() + t.slice(1) : t))
        );
      }
      const labels: Record<'date' | 'types' | 'doctor' | 'title', string> = {
        date: 'fecha',
        types: 'tipos',
        doctor: 'médico',
        title: 'título',
      };
      const applied: string[] = [];
      for (const name of ['date', 'types', 'doctor', 'title'] as const) {
        const value = detected[name];
        if (value?.length && isEmpty(name as 'date' | 'types' | 'doctor' | 'title') && !touched.current.has(name as 'date' | 'types' | 'doctor' | 'title')) {
          setFieldValue(name as 'date' | 'types' | 'doctor' | 'title', value);
          suggested.current.set(name as 'date' | 'types' | 'doctor' | 'title', JSON.stringify(value));
          const label = labels[name];
          if (label && name !== 'title') applied.push(label);
        }
      }
      const missing = ['date', 'types', 'doctor'].filter(n => isEmpty(n as 'date' | 'types' | 'doctor')).map(n => labels[n as 'date' | 'types' | 'doctor']);
      const review = applied.length ? `Revisá ${new Intl.ListFormat('es').format(applied)}. ` : '';
      setStatus(review + (missing.length ? 'Completá los campos que falten.' : 'Podés editar los datos antes de guardar.'));
      setStatusState('review');
    } catch {
      if (active()) {
        setStatus('No pudimos leer el informe. Podés completar los campos y guardar el PDF.');
      }
    } finally {
      if (analysisCtrl.current === controller) {
        clearTimeout(analysisTimeout.current!);
        setReading(false);
      }
    }
  };

  const handleTypeChange = () => {
    const selected = fieldValue('types') as string[];
    const first = formRef.current?.querySelector<HTMLInputElement>('[name=types]');
    first?.setCustomValidity(selected.length ? '' : 'Elegí al menos un tipo de estudio.');
    setTypes(selected);
    touched.current.add('types');
    suggested.current.delete('types');
  };

  const createOperation = async () => {
    const form = formRef.current;
    if (!form || operationBusy) return;
    if (!navigator.onLine) { setOperationError('Sin conexión, creá la operación desde la vista Operaciones y vinculala después de sincronizar.'); return; }
    const data = new FormData(form);
    const generation = editorGeneration.current;
    setOperationBusy(true); setOperationError('');
    try {
      const ownerOk = await verifyOwner();
      if (!ownerOk) { setOperationBusy(false); return; }
      const saved = await driveOperationRepo.save({ name: String(data.get('newOperationName') ?? ''), date: String(data.get('newOperationDate') ?? ''), surgeon: String(data.get('newOperationSurgeon') ?? ''), institution: String(data.get('newOperationInstitution') ?? ''), type: String(data.get('newOperationType') ?? ''), notes: String(data.get('newOperationNotes') ?? '') });
      if (editorGeneration.current === generation && isEditorOpen.value) {
        operations.value = [...operations.value, saved];
        setOperationId(saved.id); setCreatingOperation(false);
      }
    } catch (err) {
      if (editorGeneration.current === generation && isEditorOpen.value) setOperationError(err instanceof Error ? err.message : 'No se pudo guardar la operación.');
    } finally { setOperationBusy(false); }
  };

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
          touched.current.add(name);
          suggested.current.delete(name);
        }
      }} onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const selectedStudy = editingStudy.value;
        const selectedReport = reportInputRef.current?.files?.[0];
        void onSave({
          title: String(data.get('title') ?? '').trim(),
          date: String(data.get('date') ?? '').trim(),
          doctor: String(data.get('doctor') ?? '').trim(),
          portal: String(data.get('portal') ?? '').trim(),
          viewer: String(data.get('viewer') ?? '').trim(),
          types: data.getAll('types').map(String),
          reportName: selectedReport?.name ?? '',
          file: selectedReport ?? undefined,
          removeReport: data.has('removeReport'),
          driveFileId: selectedStudy?.id,
          revision: selectedStudy?.revision,
          operationId: String(data.get('operationId') ?? ''),
        });
      }}>
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
        <p id="detection" className="hint" role="status" data-state="">Buscamos la fecha, los tipos y el médico en el PDF.</p>
        {reading && (
          <div className="analysis-progress" aria-busy="true">
            <progress max="100" value={progress ?? undefined} aria-label="Progreso de lectura del PDF" />
            <button type="button" className="secondary" data-cancel-analysis onClick={() => {
              analysisCtrl.current?.abort();
              if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
              setReading(false);
              setStatus('Lectura cancelada. Podés completar los campos y guardar el PDF.');
            }}>Cancelar lectura</button>
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

      <label>
        Nombre del estudio
        <input
          id="editor-title-field"
          name="title"
          value={title}
          onInput={(e: Event) => { setTitle((e.currentTarget as HTMLInputElement).value); touched.current.add('title'); suggested.current.delete('title'); }}
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
          onInput={(e: Event) => { setDate((e.currentTarget as HTMLInputElement).value); touched.current.add('date'); suggested.current.delete('date'); }}
          min="1900-01-01"
          max="9999-12-31"
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
            onInput={(e: Event) => { setDoctor((e.currentTarget as HTMLInputElement).value); touched.current.add('doctor'); suggested.current.delete('doctor'); }}
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
              onChange={(e: Event) => setPortal((e.currentTarget as HTMLInputElement).value)}
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
            onChange={(e: Event) => setViewer((e.currentTarget as HTMLInputElement).value)}
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
        <button type="submit" className="button primary" id="save" disabled={busy || sessionLost}>
          {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Guardar estudio')}
        </button>
      </div>
      </form>
    </dialog>
  );
}
