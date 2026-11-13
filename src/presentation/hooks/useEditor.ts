import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { analyzePdf, validatePdf } from '@data/pdf-analysis';
import { driveAuth, driveOperationRepo, DriveSessionError } from '@data';
import { isValidDate } from '@domain/utils';
import type { Study, StudyDraft } from '@domain/models';
import { operations, isEditorOpen, setEditorOpen, editingStudy } from '../state/store';

const ANALYSIS_TIMEOUT_MS = 45_000;

interface UseEditorOptions {
  study: Study | null;
  onSave: (draft: StudyDraft) => Promise<void>;
  verifyOwner: () => Promise<boolean>;
  sessionLost?: boolean;
  onClose: () => void;
}

export function useEditor({
  study,
  onSave,
  verifyOwner,
  sessionLost = false,
  onClose,
}: UseEditorOptions) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const reportInputRef = useRef<HTMLInputElement | null>(null);
  const analysisCtrl = useRef<AbortController | null>(null);
  const analysisTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportFileRef = useRef<File | null>(null);
  const reportRemoved = useRef(false);
  const suggested = useRef<Map<'date' | 'types' | 'doctor' | 'title', string>>(new Map());
  const editorGeneration = useRef(0);

  const draft = useSignal({
    title: study?.title ?? '', date: study?.date ?? '', doctor: study?.doctor ?? '',
    portal: study?.portal ?? '', viewer: study?.viewer ?? '', types: study?.types ?? [],
    removeReport: false, operationId: study?.operationId ?? '', documentIds: study?.documentIds ?? [],
  });
  const { title, date, doctor, portal, viewer, types, removeReport, operationId, documentIds } = draft.value;
  const setTitle = (value: string) => { draft.value = { ...draft.value, title: value }; };
  const setDate = (value: string) => { draft.value = { ...draft.value, date: value }; };
  const setDoctor = (value: string) => { draft.value = { ...draft.value, doctor: value }; };
  const setPortal = (value: string) => { draft.value = { ...draft.value, portal: value }; };
  const setViewer = (value: string) => { draft.value = { ...draft.value, viewer: value }; };
  const setTypes = (value: string[]) => { draft.value = { ...draft.value, types: value }; };
  const setRemoveReport = (value: boolean) => { draft.value = { ...draft.value, removeReport: value }; };
  const setOperationId = (value: string) => { draft.value = { ...draft.value, operationId: value }; };
  const setDocumentIds = (value: string[] | ((current: string[]) => string[])) => {
    draft.value = { ...draft.value, documentIds: typeof value === 'function' ? value(draft.value.documentIds) : value };
  };
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [reportName, setReportName] = useState(study?.reportName ?? '');
  const [selectedReport, setSelectedReport] = useState<File | null>(null);
  const [checkingReport, setCheckingReport] = useState(false);
  const [candidates, setCandidates] = useState<Partial<Record<'date' | 'types' | 'doctor' | 'title', string | string[]>>>({});
  const [creatingOperation, setCreatingOperation] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState('');

  const setStatus = (value: string) => { const el = formRef.current?.querySelector<HTMLElement>('#detection'); if (el) el.textContent = value; };
  const setStatusState = (value: string) => { const el = formRef.current?.querySelector<HTMLElement>('#detection'); if (el) el.dataset.state = value; };

  useEffect(() => {
    if (sessionLost) {
      editorGeneration.current += 1;
      analysisCtrl.current?.abort();
      if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
      if (checkingReport) {
        reportFileRef.current = null;
        reportRemoved.current = true;
        if (reportInputRef.current) reportInputRef.current.value = '';
        setSelectedReport(null);
        setCheckingReport(false);
        setCandidates({});
      }
      setReading(false);
      setProgress(null);
    }
  }, [sessionLost, checkingReport]);

useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleOpenChange = () => {
      if (isEditorOpen.value) {
        if (!dialog.open) dialog.showModal();
        const current = editingStudy.value;
        if (!current) formRef.current?.reset();
        editorGeneration.current += 1;
        analysisCtrl.current?.abort();
        if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
        setCreatingOperation(false);
        setOperationError('');
        setOperationId(current?.operationId ?? '');
        setDocumentIds(current?.documentIds ?? []);
        setTitle(current?.title ?? '');
        setDate(current?.date ?? '');
        setDoctor(current?.doctor ?? '');
        setPortal(current?.portal ?? '');
        setViewer(current?.viewer ?? '');
        setTypes(current?.types ?? []);
        const candidateFile = (current as (Study & { file?: File }) | null)?.file ?? null;
        reportFileRef.current = candidateFile;
        reportRemoved.current = false;
        setSelectedReport(candidateFile);
        setCheckingReport(false);
        if (reportInputRef.current) reportInputRef.current.value = '';
        formRef.current?.querySelector<HTMLInputElement>('[name=types]')?.setCustomValidity('');
        setRemoveReport(false);
        setReportName(current?.reportName ?? '');
        setStatus('Buscamos la fecha, los tipos y el médico en el PDF.');
        setStatusState('');
        suggested.current = new Map();
        // Focus the appropriate field (sync, before next paint)
        (current ? formRef.current?.querySelector<HTMLInputElement>('[name=title]') : reportInputRef.current)?.focus();
        // Sync checkboxes
        for (const input of formRef.current?.querySelectorAll<HTMLInputElement>('[name=types]') ?? []) {
          input.checked = current?.types.includes(input.value) ?? false;
        }
        const operation = formRef.current?.querySelector<HTMLSelectElement>('#operation-id');
        if (operation) operation.value = current?.operationId ?? '';
      } else {
        dialog.close();
      }
    };

    const closed = () => {
      editorGeneration.current += 1;
      analysisCtrl.current?.abort();
      if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
      setEditorOpen(false);
      onClose();
    };
    const markTouched = (event: Event) => {
      const name = (event.target as HTMLInputElement).name;
      if (name === 'date' || name === 'types' || name === 'doctor' || name === 'title') { suggested.current.delete(name); }
    };
    formRef.current?.addEventListener('input', markTouched, true);
    dialog.addEventListener('close', closed);
    const unsubscribe = isEditorOpen.subscribe(handleOpenChange);
    handleOpenChange();
    
    return () => {
      editorGeneration.current += 1;
      analysisCtrl.current?.abort();
      if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
      unsubscribe();
      formRef.current?.removeEventListener('input', markTouched, true);
      dialog.removeEventListener('close', closed);
      dialog.close();
    };
  }, []);

  const fieldValue = useCallback((name: 'date' | 'types' | 'doctor' | 'title'): string | string[] => {
    return draft.value[name];
  }, [draft]);

  const setFieldValue = useCallback((name: 'date' | 'types' | 'doctor' | 'title', value: string | string[]): void => {
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
  }, []);

  const handleReportChange = useCallback(async (_e: Event) => {
    analysisCtrl.current?.abort();
    setReading(false);
    setProgress(null);
    for (const [name, value] of suggested.current) {
      if (JSON.stringify(fieldValue(name)) === value) {
        setFieldValue(name, name === 'types' ? [] : '');
      }
    }
    suggested.current = new Map();
    setCandidates({});

    // Use the ref directly since jsdom's dispatchEvent doesn't propagate e.target.files correctly
    const file = reportInputRef.current?.files?.[0] ?? null;
    reportFileRef.current = file;
    reportRemoved.current = false;
    setSelectedReport(file);
    setCheckingReport(Boolean(file));

    if (!file) {
      setStatus('Podés adjuntar un PDF o completar la ficha manualmente.');
      return;
    }

    const controller = new AbortController();
    analysisCtrl.current = controller;
    setReading(true);
    const { signal } = controller;
    const active = () => isEditorOpen.value && analysisCtrl.current === controller && !signal.aborted;

    const timeout = setTimeout(() => {
      if (active()) {
        controller.abort();
        setReading(false);
        setStatus('La lectura tardó demasiado. Podés completar los campos y guardar el PDF.');
      }
    }, ANALYSIS_TIMEOUT_MS);
    analysisTimeout.current = timeout;

    setStatusState('');
    const detection = formRef.current?.querySelector<HTMLElement>('#detection');
    if (detection) detection.dataset.state = '';
    setStatus('Leyendo el informe…');

    try {
      await validatePdf(file);
      if (active()) setCheckingReport(false);
    } catch (err) {
      clearTimeout(timeout);
      if (active()) {
        if (reportInputRef.current) reportInputRef.current.value = '';
        reportFileRef.current = null;
        setSelectedReport(null);
        setCheckingReport(false);
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
      const proposals: Partial<Record<'date' | 'types' | 'doctor' | 'title', string | string[]>> = {};
      for (const name of ['date', 'types', 'doctor', 'title'] as const) {
        const value = detected[name];
        if (value?.length) proposals[name] = value;
      }
      setCandidates(proposals);
      setStatus(Object.keys(proposals).length ? 'Revisá las sugerencias y aceptá las que correspondan.' : 'No encontramos sugerencias. Podés completar los datos manualmente.');
      setStatusState('review');
    } catch {
      if (active()) {
        setStatus('No pudimos leer el informe. Podés completar los campos y guardar el PDF.');
      }
    } finally {
      if (analysisCtrl.current === controller) {
        clearTimeout(timeout);
        setReading(false);
      }
    }
  }, [fieldValue, setFieldValue]);

  const handleTypeChange = useCallback(() => {
    const selected = [...(formRef.current?.querySelectorAll<HTMLInputElement>('[name="types"]:checked') ?? [])].map(input => input.value);
    const first = formRef.current?.querySelector<HTMLInputElement>('[name=types]');
    first?.setCustomValidity(selected.length ? '' : 'Elegí al menos un tipo de estudio.');
    setTypes(selected);
    suggested.current.delete('types');
  }, []);

  const createOperation = useCallback(async () => {
    const form = formRef.current;
    if (!form || operationBusy) return;
    if (!navigator.onLine) { setOperationError('Sin conexión, creá la operación desde la vista Operaciones y vinculala después de sincronizar.'); return; }
    const data = new FormData(form);
    if (!isValidDate(data.get('newOperationDate'))) { setOperationError('Ingresá una fecha válida para la cirugía.'); return; }
    if (!String(data.get('newOperationType') ?? '').trim()) { setOperationError('Ingresá el procedimiento.'); return; }
    const generation = editorGeneration.current;
    setOperationBusy(true); setOperationError('');
    try {
      const token = await driveAuth.getAccessToken();
      const ownerOk = await verifyOwner();
      if (!ownerOk) { setOperationBusy(false); return; }
      if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
      const saved = await driveOperationRepo.save({ name: String(data.get('newOperationName') ?? ''), date: String(data.get('newOperationDate') ?? ''), surgeon: String(data.get('newOperationSurgeon') ?? ''), institution: String(data.get('newOperationInstitution') ?? ''), type: String(data.get('newOperationType') ?? ''), notes: String(data.get('newOperationNotes') ?? '') });
      if (await driveAuth.getAccessToken() === token && editorGeneration.current === generation && isEditorOpen.value) {
        operations.value = [...operations.value, saved];
        setOperationId(saved.id); setCreatingOperation(false);
      }
    } catch (err) {
      if (editorGeneration.current === generation && isEditorOpen.value) setOperationError(err instanceof Error ? err.message : 'No se pudo guardar la operación.');
    } finally { setOperationBusy(false); }
  }, [operationBusy]);

  const handleClose = useCallback(() => {
    analysisCtrl.current?.abort();
    dialogRef.current?.close();
    setEditorOpen(false);
    onClose();
  }, [onClose]);

  const cancelAnalysis = useCallback(() => {
    analysisCtrl.current?.abort();
    if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
    setReading(false);
    setStatus('Lectura cancelada. Podés completar los campos y guardar el PDF.');
  }, []);

  const applySuggestion = useCallback((name: 'date' | 'types' | 'doctor' | 'title', value: string | string[]) => {
    setFieldValue(name, value);
    suggested.current.set(name, JSON.stringify(value));
    setCandidates((current) => { const next = { ...current }; delete next[name]; return next; });
  }, [setFieldValue]);

  const discardSuggestion = useCallback((name: 'date' | 'types' | 'doctor' | 'title') => {
    setCandidates((current) => { const next = { ...current }; delete next[name]; return next; });
  }, []);

  const resetForm = useCallback(() => {
    analysisCtrl.current?.abort();
    if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
    for (const [name, value] of suggested.current) {
      if (JSON.stringify(fieldValue(name)) === value) {
        setFieldValue(name, name === 'types' ? [] : '');
      }
    }
    suggested.current = new Map();
    setCandidates({});
    reportFileRef.current = null;
    reportRemoved.current = true;
    if (reportInputRef.current) reportInputRef.current.value = '';
    setSelectedReport(null);
    setCheckingReport(false);
    setReading(false);
    setProgress(null);
    setStatusState('');
    setStatus('Archivo retirado. Podés elegir otro PDF.');
  }, [fieldValue, setFieldValue]);

  const handleSubmit = useCallback(async (event: Event) => {
    event.preventDefault();
    if (checkingReport) return;
    const selectedReport = reportRemoved.current ? undefined : reportInputRef.current?.files?.[0] ?? reportFileRef.current ?? undefined;
    const currentStudy = editingStudy.value;
    const fields = draft.value;
    await onSave({
      title: fields.title.trim(),
      date: fields.date.trim(),
      doctor: fields.doctor.trim(),
      portal: fields.portal.trim(),
      viewer: fields.viewer.trim(),
      types: fields.types,
      reportName: selectedReport?.name ?? '',
      file: selectedReport ?? undefined,
      removeReport: fields.removeReport,
      driveFileId: currentStudy?.driveFileId || undefined,
      revision: currentStudy?.revision || undefined,
      operationId: fields.operationId,
      documentIds: fields.documentIds,
    });
  }, [checkingReport, draft, onSave]);

  return {
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
    setTypes,
    reading,
    progress,
    removeReport,
    setRemoveReport,
    reportName,
    setReportName,
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
  };
}
