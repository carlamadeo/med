/**
 * **useEditor** – Hook que encapsula toda la lógica del editor de estudios.
 *
 * Responsabilidades:
 * - Estado del formulario (signal reactivo `draft` + setters individuales).
 * - Lectura de informes: `handleReportChange` orquesta `validateDocument` + `analyzePdf`
 *   (pdf.js + OCR) con `AbortController` + timeout 45s + progreso.
 * - Sugerencias: propone fecha, tipos, médico, título; usuario acepta/descarta (`applySuggestion`/`discardSuggestion`).
 * - Operación nueva: `createOperation` valida, guarda en Drive, actualiza signal `operations`.
 * - Limpieza: `resetForm` cancela análisis, limpia archivo y sugerencias.
 * - Ciclo de vida: sincroniza con `isEditorOpen` + `editingStudy` signals; aborta workers al cerrar/cambiar estudio.
 * - Guardado: `handleSubmit` arma `StudyDraft` y delega a `onSave` (Drive/Outbox).
 *
 * Invariantes:
 * - `editorGeneration` evita aplicar resultados de análisis/stale a borrador incorrecto.
 * - Verifica token antes y después de mutaciones Drive (`verifyOwner` + `driveAuth.getAccessToken()`).
 * - `suggested` Map rastrea qué campos vinieron de sugerencias para no sobrescribir edición manual.
 *
 * @param study - `Study | null` desde signal `editingStudy` (null = creación).
 * @param onSave - Callback que persiste `StudyDraft` (online → Drive, offline → Outbox).
 * @param verifyOwner - Confirma que la cuenta actual coincide con la del borrador.
 * @param sessionLost - Si true, bloquea UI y muestra reconexión.
 * @param onClose - Limpia estado y cierra diálogo.
 *
 * @returns Objeto con refs, estado, setters y handlers para conectar en JSX.
 */
import {useEffect, useRef, useState, useCallback} from 'preact/hooks';
import {useSignal} from '@preact/signals';
import {analyzePdf, validateDocument} from '@data/pdf-analysis';
import {driveAuth, driveOperationRepo, DriveSessionError} from '@data';
import {isValidDate} from '@domain/utils';
import type {Operation, Study, StudyDraft} from '@domain/models';
import {isLocalDemo, operations, isEditorOpen, setEditorOpen, editingStudy} from '../state/store';

const ANALYSIS_TIMEOUT_MS = 45_000;

/**
 * Opciones de configuración para useEditor.
 * @property study - Estudio en edición (null = nuevo).
 * @property onSave - Persiste el borrador (Drive o Outbox).
 * @property verifyOwner - Verifica que la cuenta actual es la dueña.
 * @property sessionLost - True si expiró sesión/cambio de cuenta.
 * @property onClose - Limpieza al cerrar diálogo.
 */
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
    const suggested = useRef<Map<'date' | 'types' | 'doctor' | 'title', string>>(new Map());
    const editorGeneration = useRef(0);

    const draft = useSignal({
        title: study?.title ?? '', date: study?.date ?? '', doctor: study?.doctor ?? '',
        specialty: study?.specialty ?? '',
        portal: study?.portal ?? '', viewer: study?.viewer ?? '', types: study?.types ?? [],
        removeReport: false, operationId: study?.operationId ?? '', documentIds: study?.documentIds ?? [],
        printed: study?.printed ?? {report: false, image: false},
    });
    const {title, date, doctor, specialty, portal, viewer, types, removeReport, operationId, documentIds, printed} = draft.value;
    const setField = <K extends keyof typeof draft.value>(key: K) => (value: (typeof draft.value)[K]) => {
        draft.value = {...draft.value, [key]: value};
    };
    const setPrinted = (kind: keyof typeof printed, checked: boolean) => {
        draft.value = {...draft.value, printed: {...draft.value.printed, [kind]: checked}};
    };
    const setTitle = setField('title');
    const setDate = setField('date');
    const setDoctor = setField('doctor');
    const setSpecialty = setField('specialty');
    const setPortal = setField('portal');
    const setViewer = setField('viewer');
    const setTypes = setField('types');
    const setRemoveReport = setField('removeReport');
    const setOperationId = setField('operationId');
    const setDocumentIds = (value: string[] | ((current: string[]) => string[])) => {
        draft.value = {
            ...draft.value,
            documentIds: typeof value === 'function' ? value(draft.value.documentIds) : value
        };
    };
    const [reading, setReading] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [selectedReport, setSelectedReport] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [checkingReport, setCheckingReport] = useState(false);
    const [candidates, setCandidates] = useState<Partial<Record<'date' | 'types' | 'doctor' | 'title', string | string[]>>>({});
    const [creatingOperation, setCreatingOperation] = useState(false);
    const [operationBusy, setOperationBusy] = useState(false);
    const [operationError, setOperationError] = useState('');

    const setStatus = (value: string) => {
        const el = formRef.current?.querySelector<HTMLElement>('#detection');
        if (el) el.textContent = value;
    };
    const setStatusState = (value: string) => {
        const el = formRef.current?.querySelector<HTMLElement>('#detection');
        if (el) el.dataset.state = value;
    };

    useEffect(() => {
        if (!selectedReport) {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
            }
            return;
        }
        if (selectedReport.type.startsWith('image/')) {
            try {
                if (typeof URL.createObjectURL === 'function') {
                    const url = URL.createObjectURL(selectedReport);
                    setPreviewUrl(url);
                    return () => {
                        try {
                            URL.revokeObjectURL(url);
                        } catch {
                            // Silencioso en entornos de prueba
                        }
                    };
                }
            } catch {
                setPreviewUrl(null);
            }
        } else {
            if (previewUrl) {
                try {
                    URL.revokeObjectURL(previewUrl);
                } catch {
                    // Silencioso en entornos de prueba
                }
                setPreviewUrl(null);
            }
        }
    }, [selectedReport]);

    useEffect(() => {
        if (sessionLost) {
            editorGeneration.current += 1;
            analysisCtrl.current?.abort();
            if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
            if (checkingReport) {
                reportFileRef.current = null;
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
                draft.value = {...draft.value, printed: current?.printed ?? {report: false, image: false}};
                setTitle(current?.title ?? '');
                setDate(current?.date ?? '');
                setDoctor(current?.doctor ?? '');
                setSpecialty(current?.specialty ?? '');
                setPortal(current?.portal ?? '');
                setViewer(current?.viewer ?? '');
                setTypes(current?.types ?? []);
                const candidateFile = (current as (Study & { file?: File }) | null)?.file ?? null;
                reportFileRef.current = candidateFile;
                setSelectedReport(candidateFile);
                setCheckingReport(false);
                setReading(false);
                setProgress(null);
                setCandidates({});
                if (reportInputRef.current) reportInputRef.current.value = '';
                formRef.current?.querySelector<HTMLInputElement>('[name=types]')?.setCustomValidity('');
                setRemoveReport(false);
                setStatus('Buscamos la fecha, los tipos y el médico en el informe.');
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
                if (candidateFile && !current?.date) void processFile(candidateFile);
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
            if (name === 'date' || name === 'types' || name === 'doctor' || name === 'title') {
                suggested.current.delete(name);
            }
        };
        formRef.current?.addEventListener('input', markTouched, true);
        dialog.addEventListener('close', closed);
        const unsubscribe = isEditorOpen.subscribe(handleOpenChange);

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

    /**
     * Procesa un archivo adjunto (desde input, cámara o dropzone).
     * 1. Aborta análisis previo + limpia sugerencias ya aplicadas.
     * 2. Valida formato y tamaño del adjunto (límite 20 MB).
     * 3. Lanza `analyzePdf` con AbortSignal + timeout 45s + callbacks de progreso.
     * 4. Extrae candidatos (fecha, tipos, doctor, título) y expone en `candidates`.
     */
    const processFile = useCallback(async (file: File) => {
        analysisCtrl.current?.abort();
        if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
        setReading(false);
        setProgress(null);
        for (const [name, value] of suggested.current) {
            if (JSON.stringify(fieldValue(name)) === value) {
                setFieldValue(name, name === 'types' ? [] : '');
            }
        }
        suggested.current = new Map();
        setCandidates({});

        if (file.size > 20 * 1024 * 1024) {
            reportFileRef.current = null;
            if (reportInputRef.current) reportInputRef.current.value = '';
            setSelectedReport(null);
            setCheckingReport(false);
            setStatus('El archivo supera el límite de 20 MB.');
            setStatusState('error');
            return;
        }

        reportFileRef.current = null;
        setSelectedReport(file);
        setCheckingReport(true);

        const controller = new AbortController();
        analysisCtrl.current = controller;
        setReading(true);
        const {signal} = controller;
        const active = () => isEditorOpen.value && analysisCtrl.current === controller && !signal.aborted;

        const timeout = setTimeout(() => {
            if (active()) {
                controller.abort();
                setReading(false);
                setCheckingReport(false);
                if (!reportFileRef.current) setSelectedReport(null);
                setStatus('La lectura tardó demasiado. Completá los datos y revisá el archivo antes de guardar.');
            }
        }, ANALYSIS_TIMEOUT_MS);
        analysisTimeout.current = timeout;

        setStatusState('');
        const detection = formRef.current?.querySelector<HTMLElement>('#detection');
        if (detection) detection.dataset.state = '';
        setStatus('Leyendo el informe…');

        try {
            await validateDocument(file);
            if (!active()) return;
            reportFileRef.current = file;
            setCheckingReport(false);
        } catch (err) {
            clearTimeout(timeout);
            if (active()) {
                setSelectedReport(null);
                setCheckingReport(false);
                setStatus(err instanceof Error ? err.message : 'Elegí un PDF, JPEG o PNG válido.');
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

            const detected: Record<string, string | string[]> = {...(found as Record<string, string | string[]>)};
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
                setStatus('No pudimos leer el informe. Podés completar los campos y guardar el archivo.');
            }
        } finally {
            if (analysisCtrl.current === controller) {
                clearTimeout(timeout);
                setReading(false);
            }
        }
    }, [fieldValue, setFieldValue]);

    const handleReportChange = useCallback(async (event: Event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        input.value = '';
        await processFile(file);
    }, [processFile]);

    const handleFileDrop = useCallback(async (file: File) => {
        await processFile(file);
    }, [processFile]);

    const handleTypeChange = useCallback(() => {
        const selected = [...(formRef.current?.querySelectorAll<HTMLInputElement>('[name="types"]:checked') ?? [])].map(input => input.value);
        const first = formRef.current?.querySelector<HTMLInputElement>('[name=types]');
        first?.setCustomValidity(selected.length ? '' : 'Elegí al menos un tipo de estudio.');
        setTypes(selected);
        suggested.current.delete('types');
    }, []);

    /**
     * Crea operación nueva sin perder datos del estudio actual.
     * Solo online; valida fecha, tipo; guarda en Drive; actualiza signal `operations`
     * y setea `operationId` en el borrador. Verifica token antes/después.
     */
    const createOperation = useCallback(async () => {
        const form = formRef.current;
        if (!form || operationBusy) return;
        if (!isLocalDemo.value && !navigator.onLine) {
            setOperationError('Sin conexión, creá la operación desde la vista Operaciones y vinculala después de sincronizar.');
            return;
        }
        const data = new FormData(form);
        if (!isValidDate(data.get('newOperationDate'))) {
            setOperationError('Ingresá una fecha válida para la cirugía.');
            return;
        }
        if (!String(data.get('newOperationType') ?? '').trim()) {
            setOperationError('Ingresá el procedimiento.');
            return;
        }
        if (isLocalDemo.value) {
            const saved: Operation = {
                id: `demo-op-${Date.now()}`,
                name: String(data.get('newOperationName') ?? ''),
                date: String(data.get('newOperationDate') ?? ''),
                surgeon: String(data.get('newOperationSurgeon') ?? ''),
                institution: String(data.get('newOperationInstitution') ?? ''),
                type: String(data.get('newOperationType') ?? ''),
                notes: String(data.get('newOperationNotes') ?? ''),
                studyIds: [],
                color: '',
                revision: '1',
            };
            operations.value = [...operations.value, saved];
            setOperationId(saved.id);
            setCreatingOperation(false);
            return;
        }
        const generation = editorGeneration.current;
        setOperationBusy(true);
        setOperationError('');
        try {
            const token = await driveAuth.getAccessToken();
            const ownerOk = await verifyOwner();
            if (!ownerOk) {
                setOperationBusy(false);
                return;
            }
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            const saved = await driveOperationRepo.save({
                name: String(data.get('newOperationName') ?? ''),
                date: String(data.get('newOperationDate') ?? ''),
                surgeon: String(data.get('newOperationSurgeon') ?? ''),
                institution: String(data.get('newOperationInstitution') ?? ''),
                type: String(data.get('newOperationType') ?? ''),
                notes: String(data.get('newOperationNotes') ?? '')
            });
            if (await driveAuth.getAccessToken() === token && editorGeneration.current === generation && isEditorOpen.value) {
                operations.value = [...operations.value, saved];
                setOperationId(saved.id);
                setCreatingOperation(false);
            }
        } catch (err) {
            if (editorGeneration.current === generation && isEditorOpen.value) setOperationError(err instanceof Error ? err.message : 'No se pudo guardar la operación.');
        } finally {
            setOperationBusy(false);
        }
    }, [operationBusy]);

    const handleClose = useCallback(() => {
        analysisCtrl.current?.abort();
        dialogRef.current?.close();
        setEditorOpen(false);
        onClose();
    }, [onClose]);

    /**
     * Cancela la lectura en curso (aborta worker + limpia timeout).
     * Mantiene archivo seleccionado y campos editados manualmente.
     */
    const cancelAnalysis = useCallback(() => {
        analysisCtrl.current?.abort();
        if (analysisTimeout.current) clearTimeout(analysisTimeout.current);
        setReading(false);
        setStatus('Lectura cancelada. Podés completar los campos y guardar el archivo.');
    }, []);

    /**
     * Aplica sugerencia de extracción al campo correspondiente.
     * Registra en `suggested` Map para no sobrescribir si usuario edita manualmente luego.
     * Remueve la sugerencia de la UI (`candidates`).
     */
    const applySuggestion = useCallback((name: 'date' | 'types' | 'doctor' | 'title', value: string | string[]) => {
        setFieldValue(name, value);
        suggested.current.set(name, JSON.stringify(value));
        setCandidates((current) => {
            const next = {...current};
            delete next[name];
            return next;
        });
    }, [setFieldValue]);

    /**
     * Descarta sugerencia sin aplicarla; solo la quita de la UI (`candidates`).
     * No modifica el valor del campo en el borrador.
     */
    const discardSuggestion = useCallback((name: 'date' | 'types' | 'doctor' | 'title') => {
        setCandidates((current) => {
            const next = {...current};
            delete next[name];
            return next;
        });
    }, []);

    /**
     * Resetea formulario a estado inicial (sin archivo, sin sugerencias).
     * Aborta el análisis y quita el archivo recién seleccionado.
     */
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
        if (reportInputRef.current) reportInputRef.current.value = '';
        setSelectedReport(null);
        setCheckingReport(false);
        setReading(false);
        setProgress(null);
        setStatusState('');
        setStatus('Archivo retirado. Podés elegir otro PDF o imagen.');
    }, [fieldValue, setFieldValue]);

    /**
     * Envía formulario: arma StudyDraft y delega a onSave.
     * Incluye: file, removeReport, driveFileId/revision (si edición),
     * operationId, documentIds. Bloquea durante la validación del archivo.
     */
    const handleSubmit = useCallback(async (event: Event) => {
        event.preventDefault();
        if (checkingReport) return;
        const selectedReport = reportFileRef.current ?? undefined;
        const currentStudy = editingStudy.value;
        const fields = draft.value;
        await onSave({
            title: fields.title.trim(),
            date: fields.date.trim(),
            doctor: fields.doctor.trim(),
            specialty: fields.specialty.trim(),
            portal: fields.portal.trim(),
            viewer: fields.viewer.trim(),
            types: fields.types,
            reportName: selectedReport?.name ?? '',
            printed: fields.printed,
            file: selectedReport ?? undefined,
            removeReport: fields.removeReport,
            id: isLocalDemo.value ? currentStudy?.id : undefined,
            driveFileId: currentStudy?.driveFileId || undefined,
            revision: currentStudy?.revision || undefined,
            operationId: fields.operationId,
            documentIds: fields.documentIds,
            intakeSourceId: currentStudy?.intakeSourceId,
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
        specialty,
        setSpecialty,
        portal,
        setPortal,
        viewer,
        setViewer,
        types,
        setTypes,
        reading,
        progress,
        removeReport,
        printed,
        setPrinted,
        setRemoveReport,
        selectedReport,
        previewUrl,
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
        handleFileDrop,
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
