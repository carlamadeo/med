/**
 * Diálogo de editor: crear o editar un estudio.
 * Incluye la lectura automática de PDF (pdf.js + OCR) con aborte y timeout.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { analyzePdf, validatePdf } from '@data/pdf-analysis';
import {
  editingStudy,
  isEditorOpen,
  setEditorOpen,
} from '../state/store';

const ANALYSIS_TIMEOUT_MS = 45_000;

interface EditorDialogProps {
  onClose: () => void;
  error: string | null;
  busy: boolean;
}

export function EditorDialog({
  onClose,
  error,
  busy,
}: EditorDialogProps) {
  const study = editingStudy.value;
  const isEdit = !!study;
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [title, setTitle] = useState<string>(study?.title ?? '');
  const [date, setDate] = useState<string>(study?.date ?? '');
  const [doctor, setDoctor] = useState<string>(study?.doctor ?? '');
  const [portal, setPortal] = useState<string>(study?.portal ?? '');
  const [viewer, setViewer] = useState<string>(study?.viewer ?? '');
  const [types, setTypes] = useState<string[]>(study?.types ?? []);
  const [removeReport, setRemoveReport] = useState(false);
  const [reportName, setReportName] = useState(study?.reportName ?? '');

  const [status, setStatus] = useState<string>('Buscamos la fecha, los tipos y el médico en el PDF.');
  const [statusState, setStatusState] = useState<string>('');

  const reportInputRef = useRef<HTMLInputElement | null>(null);
  const analysisCtrl = useRef<AbortController | null>(null);
  const analysisTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportFileRef = useRef<File | null>(null);

  const touched = useRef<Set<'date' | 'types' | 'doctor' | 'title'>>(new Set());
  const suggested = useRef<Map<'date' | 'types' | 'doctor' | 'title', string>>(new Map());

  // Open/close dialog imperatively - subscribe to signal directly
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleOpenChange = () => {
      if (isEditorOpen.value) {
        dialog.showModal();
        // Reset form when dialog opens
        setTitle(study?.title ?? '');
        setDate(study?.date ?? '');
        setDoctor(study?.doctor ?? '');
        setPortal(study?.portal ?? '');
        setViewer(study?.viewer ?? '');
        setTypes(study?.types ?? []);
        reportFileRef.current = null;
        setRemoveReport(false);
        setReportName(study?.reportName ?? '');
        setStatus('Buscamos la fecha, los tipos y el médico en el PDF.');
        setStatusState('');
        touched.current = new Set();
        suggested.current = new Map();
      } else {
        dialog.close();
      }
    };

    // Subscribe to signal changes
    const unsubscribe = isEditorOpen.subscribe(handleOpenChange);
    
    // Initial check - read signal directly
    handleOpenChange();

    return () => {
      unsubscribe();
      dialog.close();
    };
  }, [study]);

  const handleClose = () => {
    analysisCtrl.current?.abort();
    dialogRef.current?.close();
    setEditorOpen(false);
    onClose();
  };

  const fieldValue = (name: 'date' | 'types' | 'doctor' | 'title'): string | string[] => {
    if (name === 'types') return types;
    if (name === 'date') return date;
    if (name === 'doctor') return doctor;
    return title;
  };

  const setFieldValue = (name: 'date' | 'types' | 'doctor' | 'title', value: string | string[]): void => {
    if (name === 'types') {
      setTypes(value as string[]);
    } else if (name === 'date') {
      setDate(value as string);
    } else if (name === 'doctor') {
      setDoctor(value as string);
    } else if (name === 'title') {
      setTitle(value as string);
    }
  };

  const isEmpty = (name: 'date' | 'types' | 'doctor' | 'title'): boolean => {
    return fieldValue(name).length === 0;
  };

  const handleReportChange = async (_e: Event) => {
    analysisCtrl.current?.abort();
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
    const { signal } = controller;
    const active = () => editingStudy.value !== null && analysisCtrl.current === controller && !signal.aborted;

    analysisTimeout.current = setTimeout(() => {
      controller.abort();
      if (active()) {
        setStatus('La lectura tardó demasiado. Podés completar los campos y guardar el PDF.');
      }
    }, ANALYSIS_TIMEOUT_MS);

    setStatus('Leyendo el informe…');

    try {
      await validatePdf(file);
    } catch (err) {
      clearTimeout(analysisTimeout.current!);
      if (active()) {
        setStatus(err instanceof Error ? err.message : 'Elegí un archivo PDF válido.');
        setStatusState('error');
      }
      return;
    }

    try {
      const found = await analyzePdf(file, signal, () => {
        if (active()) {
          setStatus('Leyendo el texto de una imagen. Puede demorar unos segundos…');
        }
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
          suggested.current.set(name as 'date' | 'types' | 'doctor' | 'title', JSON.stringify(fieldValue(name as 'date' | 'types' | 'doctor' | 'title')));
          const label = labels[name];
          if (label) applied.push(label);
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
      clearTimeout(analysisTimeout.current!);
    }
  };

  const handleTypeChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const val = types;
    if (target.checked) {
      if (!val.includes(target.value)) setTypes([...val, target.value]);
    } else {
      setTypes(val.filter(v => v !== target.value));
    }
    touched.current.add('types');
    suggested.current.delete('types');
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog editor"
      aria-labelledby="editor-title"
      data-busy={busy ? 'true' : undefined}
    >
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
        <p id="detection" className="hint" role="status" data-state={statusState}>
          {status}
        </p>
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
          onChange={(e: Event) => { setTitle((e.currentTarget as HTMLInputElement).value); touched.current.add('title'); suggested.current.delete('title'); }}
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
          onChange={(e: Event) => { setDate((e.currentTarget as HTMLInputElement).value); touched.current.add('date'); suggested.current.delete('date'); }}
          min="1900-01-01"
          max="9999-12-31"
          required
        />
      </label>
      <fieldset className="study-types" aria-describedby="types-hint">
        <legend>Tipos de estudio</legend>
        <p className="hint" id="types-hint">Elegí uno o varios.</p>
        <div className="type-options">
          {types.map(t => (
            <label key={t} className="type-option">
              <input
                type="checkbox"
                name="types"
                value={t}
                checked={types.includes(t)}
                onChange={handleTypeChange}
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
            onChange={(e: Event) => { setDoctor((e.currentTarget as HTMLInputElement).value); touched.current.add('doctor'); suggested.current.delete('doctor'); }}
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
        </div>
      </div>
      <p className="hint" id="portal-hint">Podés elegir una institución que ya usaste o escribir una nueva. Se recuerda al guardar el estudio.</p>
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
      <p className="form-error" id="form-error" role="alert">{error}</p>
      {busy ? (
        <button type="button" className="button secondary reconnect">Reconectar Google Drive</button>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="button quiet" data-close onClick={handleClose}>
          Cancelar
        </button>
        <button type="submit" className="button primary" id="save" disabled={busy}>
          {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Guardar estudio')}
        </button>
      </div>
    </dialog>
  );
}