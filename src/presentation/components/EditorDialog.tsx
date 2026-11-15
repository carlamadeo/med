/**
 * **EditorDialog** – Diálogo modal para crear o editar un estudio médico.
 *
 * Funcionalidades clave:
 * - **Adjunto PDF o imagen**: selector, cámara, validación y lectura en un worker.
 * - **Extracción asistida**: sugiere fecha, tipos, médico y título del informe.
 * - **Cancelación**: `AbortSignal` cancela worker y evita resultados tardíos.
 * - **Operaciones**: permite crear operación nueva sin perder datos del formulario actual.
 * - **Documentos vinculados**: reusa adjuntos de otros estudios sin duplicar.
 * - **Sesión perdida**: detecta `sessionLost`, muestra botón de reconexión y bloquea guardado.
 *
 * Estado:
 * - Recibe `editingStudy` (signal) para saber si es edición o creación.
 * - Delega lógica de formulario/lectura a hook `useEditor`.
 * - `portalNames` (domain) sugiere instituciones ya usadas.
 *
 * Props:
 * - `onClose`: cierra diálogo y limpia estado (`resetForm` en hook).
 * - `error`: mensaje de error global (p.ej. conflicto de revisión).
 * - `busy`: loading global (guarda estudio).
 * - `availableTypes`: catálogo de tipos desde `study-types.ts`.
 * - `onSave(draft)`: persistencia (Drive online / Outbox offline).
 * - `verifyOwner()`: confirma que la cuenta actual coincide con la del borrador.
 * - `sessionLost`: true si expiró token o cambió cuenta.
 * - `onReconnect`: inicia flujo OAuth.
 *
 * Accesibilidad:
 * - `<dialog>` nativo con `aria-labelledby` dinámico.
 * - `role="alert"` en errores y progreso.
 * - Focus trap via `useFocusTrap` (hook).
 * - Navegación por teclado completa.
 *
 * @example
 * ```tsx
 * <EditorDialog
 *   onClose={closeEditor}
 *   error={saveError}
 *   busy={saving}
 *   availableTypes={types}
 *   onSave={handleSave}
 *   verifyOwner={checkOwner}
 *   sessionLost={!!sessionLost}
 *   onReconnect={reconnect}
 * />
 * ```
 */
import {useEditor} from '../hooks/useEditor';
import {useFocusTrap} from '../utils/focusTrap';
import {formatStudyDate, portalNames} from '@domain/library';
import {todayLocal} from '@domain/utils';
import {MultiSelectCombobox} from './MultiSelectCombobox';
import {useEffect, useRef, useState} from 'preact/hooks';
import {
    editingStudy,
    studies,
    operations,
    isEditorOpen,
} from '../state/store';

import type {StudyDraft} from '@domain/models';

// Test-only: allow setting types programmatically for e2e tests
let _testOnlySetTypes: ((types: string[]) => void) | null = null;
export const __testOnlySetTypes = (callback: (setTypes: (types: string[]) => void) => void) => {
    if (_testOnlySetTypes) callback(_testOnlySetTypes);
};
export const __testOnlyClearTypes = () => { _testOnlySetTypes = null; };

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
    const relatedGroups = study ? study.types.map((type) => ({
        type,
        items: studies.value.filter((item) => item.id !== study.id && item.types.includes(type))
            .sort((a, b) => b.date.localeCompare(a.date)),
    })).filter((group) => group.items.length > 0) : [];

    const [isDragging, setIsDragging] = useState(false);
    const [portalOpen, setPortalOpen] = useState(false);
    const portalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (portalRef.current && !portalRef.current.contains(e.target as Node)) {
                setPortalOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
        setTypes,
        reading,
        progress,
        removeReport,
        setRemoveReport,
        reportName,
        selectedReport,
        previewUrl,
        checkingReport,
        candidates,
        operationId,
        setOperationId,
        creatingOperation,
        setCreatingOperation,
        operationBusy,
        operationError,
        setOperationError,
        handleReportChange,
        handleFileDrop,
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

    // Test-only: expose setTypes for e2e tests
    useEffect(() => {
        _testOnlySetTypes = setTypes;
        return () => { _testOnlySetTypes = null; };
    }, [setTypes]);

    useFocusTrap(dialogRef, isEditorOpen.value);

    const applyAllSuggestions = () => {
        for (const name of ['date', 'types', 'doctor', 'title'] as const) {
            const val = candidates[name];
            if (val) applySuggestion(name, val);
        }
    };

    return (
        <dialog
            id="editor"
            ref={dialogRef}
            className="dialog editor"
            aria-labelledby={sessionLost ? 'editor-session-title' : 'editor-title'}
            data-busy={busy ? 'true' : 'false'}
            onCancel={(event) => {
                if (busy || operationBusy) event.preventDefault();
            }}
        >
            <form ref={formRef} id="editor-form" onInput={(event) => {
                const name = (event.target as HTMLInputElement).name;
                if (name === 'date' || name === 'types' || name === 'doctor' || name === 'title') {
                    // suggested.current.delete(name) - handled by hook
                }
            }} onSubmit={handleSubmit}>
                <fieldset hidden={sessionLost} disabled={busy || operationBusy || sessionLost}
                          style={{border: 0, padding: 0, margin: 0}}>
                    <div className="dialog-heading">
                        <div>
                            <h2 id="editor-title">{isEdit ? 'Editar estudio' : 'Agregar estudio'}</h2>
                            <p>Adjuntá un informe para recibir sugerencias o completá los datos a mano.</p>
                        </div>
                        <button
                            type="button"
                            className="icon-button"
                            data-close
                            aria-label="Cerrar"
                            onClick={handleClose}
                        >
                            <svg className="icon">
                                <use href="#i-close"/>
                            </svg>
                        </button>
                    </div>

                    <div
                        className={`attachments report-upload dropzone ${isDragging ? 'is-dragover' : ''}`}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragging(true);
                        }}
                        onDragEnter={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragging(true);
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragging(false);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragging(false);
                            const file = e.dataTransfer?.files?.[0];
                            if (file) {
                                void handleFileDrop(file);
                            }
                        }}
                    >
                        <div className="dropzone-header">
                            <span className="dropzone-icon" aria-hidden="true">
                                <svg className="icon"><use href="#i-upload"/></svg>
                            </span>
                            <div className="dropzone-text">
                                <span className="dropzone-title">Arrastrá tu informe acá o elegí un archivo</span>
                                <small>PDF, JPEG o PNG · hasta 20 MB · opcional</small>
                            </div>
                        </div>

                        <div className="dropzone-actions">
                            <label className="button secondary dropzone-button">
                                <span>Seleccionar archivo</span>
                                <input
                                    ref={reportInputRef}
                                    name="report"
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                    onChange={handleReportChange}
                                    tabIndex={0}
                                />
                            </label>
                            <label className="button quiet dropzone-camera-button">
                                <span>Tomar foto</span>
                                <input
                                    name="camera-report"
                                    type="file"
                                    accept="image/jpeg,image/png"
                                    capture="environment"
                                    onChange={handleReportChange}
                                />
                            </label>
                        </div>

                        {selectedReport && (
                            <div id="selected-report" className="selected-report-card">
                                <div className="report-preview-box">
                                    {previewUrl ? (
                                        <img src={previewUrl} alt="Vista previa del informe" className="report-preview-thumb" />
                                    ) : (
                                        <div className="report-preview-badge" aria-hidden="true">
                                            <span>PDF</span>
                                        </div>
                                    )}
                                </div>
                                <div className="selected-report-info">
                                    <p className="selected-report-name">{selectedReport.name}</p>
                                    <p className="selected-report-meta">
                                        {selectedReport.size.toLocaleString('es-AR')} bytes
                                        · {checkingReport ? 'Validando archivo' : 'Listo para revisar · todavía sin guardar'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="button quiet"
                                    data-remove-selected-report
                                    onClick={resetForm}
                                    aria-label="Quitar archivo seleccionado"
                                >
                                    Quitar archivo seleccionado
                                </button>
                            </div>
                        )}
                        <p id="detection" className="hint" role="status" data-state="">Buscamos la fecha, los tipos y el
                            médico en el informe.</p>
                        {Object.keys(candidates).length > 0 && (
                            <section id="extraction-suggestions" className="extraction-suggestions" aria-label="Sugerencias de lectura">
                                <div className="suggestions-header">
                                    <div className="suggestions-title">
                                        <svg className="icon" aria-hidden="true"><use href="#i-scan"/></svg>
                                        <span>Sugerencias del informe</span>
                                    </div>
                                    {Object.keys(candidates).length > 1 && (
                                        <button
                                            type="button"
                                            className="button quiet text-btn"
                                            onClick={applyAllSuggestions}
                                        >
                                            Aceptar todas
                                        </button>
                                    )}
                                </div>
                                <p className="hint">Estas sugerencias no se guardan hasta que las aceptes.</p>
                                <div className="suggestions-grid">
                                    {(['date', 'types', 'doctor', 'title'] as const).map((name) => {
                                        const value = candidates[name];
                                        if (!value) return null;
                                        const label = {
                                            date: 'Fecha',
                                            types: 'Tipos',
                                            doctor: 'Médico',
                                            title: 'Título'
                                        }[name];
                                        return (
                                            <div key={name} className="suggestion-chip">
                                                <div className="suggestion-info">
                                                    <span className="suggestion-label">{label}</span>
                                                    <strong className="suggestion-val">
                                                        {Array.isArray(value) ? value.join(', ') : value}
                                                    </strong>
                                                </div>
                                                <div className="suggestion-actions">
                                                    <button
                                                        type="button"
                                                        className="button secondary sm-btn"
                                                        data-accept-suggestion={name}
                                                        onClick={() => applySuggestion(name, value)}
                                                    >
                                                        Aceptar {label.toLowerCase()}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="button quiet sm-btn"
                                                        onClick={() => discardSuggestion(name)}
                                                    >
                                                        Descartar {label.toLowerCase()}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}
                        {reading && (
                            <div className="analysis-progress" aria-busy="true">
                                <progress max="100" value={progress ?? undefined}
                                          aria-label="Progreso de lectura del informe"/>
                                <button type="button" className="secondary" data-cancel-analysis
                                        disabled={checkingReport} onClick={cancelAnalysis}>Cancelar lectura
                                </button>
                            </div>
                        )}
                        {reportName && (
                            <div id="current-report">
                                <span id="current-report-name">{reportName}</span>
                                <label className="checkbox">
                                    <input name="removeReport" type="checkbox" checked={removeReport}
                                           onChange={() => setRemoveReport(!removeReport)}/>
                                    {study?.attachmentMime ? 'Quitar imagen actual' : 'Quitar PDF actual'}
                                </label>
                            </div>
                        )}
                    </div>

                    <div className="form-section">
                        <h3 className="form-section-title">Datos del estudio</h3>
                        <div className="two form-grid-2">
                            <label>
                                Nombre del estudio
                                <input
                                    id="editor-title-field"
                                    name="title"
                                    value={title}
                                    onInput={(e: Event) => {
                                        setTitle((e.currentTarget as HTMLInputElement).value);
                                    }}
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
                                    onInput={(e: Event) => {
                                        setDate((e.currentTarget as HTMLInputElement).value);
                                    }}
                                    min="1900-01-01"
                                    max={todayLocal()}
                                    required
                                />
                            </label>
                        </div>
                        <fieldset id="study-types" className="study-types" aria-describedby="types-hint">
                            <legend>Tipos de estudio</legend>
                            <p className="hint" id="types-hint">Elegí uno o varios para clasificar y filtrar en tu archivo.</p>
                            <MultiSelectCombobox
                                options={availableTypes}
                                value={types}
                                onChange={setTypes}
                                placeholder="Elegí tipos…"
                                required
                                ariaDescribedBy="types-hint"
                            />
                        </fieldset>
                    </div>

                    <div className="form-section">
                        <h3 className="form-section-title">Profesional e institución</h3>
                        <div className="two form-grid-2">
                            <label>
                                Médico o profesional <small>Opcional</small>
                                <input
                                    name="doctor"
                                    value={doctor}
                                    onInput={(e: Event) => {
                                        setDoctor((e.currentTarget as HTMLInputElement).value);
                                    }}
                                    maxLength={120}
                                    placeholder="Ej. Dra. Ana Pérez"
                                />
                            </label>
                            <div className="portal-field" ref={portalRef}>
                                <label>
                                    Portal o institución <small>Opcional</small>
                                    <input
                                        name="portal"
                                        value={portal}
                                        onInput={(e: Event) => {
                                            setPortal((e.currentTarget as HTMLInputElement).value);
                                            setPortalOpen(true);
                                        }}
                                        onFocus={() => {
                                            if (portalNames(studies.value).length > 0) setPortalOpen(true);
                                        }}
                                        maxLength={120}
                                        placeholder="Escribí o elegí una institución"
                                        autoComplete="off"
                                        aria-describedby="portal-hint"
                                    />
                                </label>
                                {portalOpen && portalNames(studies.value).filter(name =>
                                    portal.trim() ? name.toLowerCase().includes(portal.trim().toLowerCase()) : true
                                ).length > 0 && (
                                    <ul id="portal-options" className="portal-autocomplete-dropdown" role="listbox">
                                        {portalNames(studies.value).filter(name =>
                                            portal.trim() ? name.toLowerCase().includes(portal.trim().toLowerCase()) : true
                                        ).map(name => (
                                            <li key={name} role="option">
                                                <button
                                                    type="button"
                                                    className="portal-autocomplete-item"
                                                    onClick={() => {
                                                        setPortal(name);
                                                        setPortalOpen(false);
                                                        const input = formRef.current?.querySelector<HTMLInputElement>('[name="portal"]');
                                                        if (input) {
                                                            input.value = name;
                                                            input.focus();
                                                        }
                                                    }}
                                                >
                                                    {name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                        <p className="hint" id="portal-hint">Podés elegir una institución que ya usaste o escribir una nueva.</p>
                    </div>

                    <div className="form-section">
                        <h3 className="form-section-title">Opciones adicionales</h3>
                        <label className="viewer-link-field">
                            Enlace al visor web <small>Opcional</small>
                            <input
                                name="viewer"
                                type="url"
                                inputmode="url"
                                value={viewer}
                                onInput={(e: Event) => setViewer((e.currentTarget as HTMLInputElement).value)}
                                maxLength={5000}
                                placeholder="https://miportal.com/visor/…"
                            />
                        </label>
                        <p className="hint">El enlace se abrirá directamente en el visor de tu portal médico.</p>

                        <details className="editor-advanced">
                            <summary>Vincular con operación quirúrgica</summary>
                            <label>Operación <small>Opcional</small>
                                <select id="operation-id" name="operationId" value={operationId}
                                        onChange={(event) => setOperationId(event.currentTarget.value)}>
                                    <option value="">Sin operación</option>
                                    {operations.value.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
                                </select>
                            </label>
                            <button id="create-operation" type="button" className="button quiet" onClick={() => {
                                setCreatingOperation(!creatingOperation);
                                setOperationError('');
                            }}>Crear operación nueva
                            </button>
                            {creatingOperation && <fieldset disabled={operationBusy}>
                                <legend>Nueva operación</legend>
                                <label>Nombre <input id="new-operation-name" name="newOperationName" maxLength={120}/></label>
                                <label>Fecha <input name="newOperationDate" type="date"/></label>
                                <label>Cirujano <input name="newOperationSurgeon"/></label>
                                <label>Institución <input name="newOperationInstitution"/></label>
                                <label>Intervención <input name="newOperationType"/></label>
                                <label>Notas <textarea name="newOperationNotes"/></label>
                                {operationError && <p role="alert">{operationError}</p>}
                                <button type="button" id="save-new-operation"
                                        onClick={() => void createOperation()}>{operationBusy ? 'Guardando…' : 'Guardar operación'}</button>
                                <button type="button" onClick={() => setCreatingOperation(false)}>Cancelar</button>
                            </fieldset>}
                        </details>
                    </div>

                    {relatedGroups.length > 0 && (
                        <section className="editor-related" aria-label="Estudios relacionados">
                            {relatedGroups.map(({type, items}) => (
                                <div key={type}>
                                    <h3>Otros estudios de {type}</h3>
                                    <p>{items.length} {items.length === 1 ? 'estudio' : 'estudios'}, ordenados por fecha</p>
                                    <ul>
                                        {items.map((item) => (
                                            <li key={item.id}>
                                                <span>
                                                    {item.title}
                                                    {item.syncStatus && ` · ${item.syncStatus === 'conflict' ? 'Requiere revisión' : item.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}`}
                                                </span>
                                                <time dateTime={item.date}>{formatStudyDate(item.date)}</time>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </section>
                    )}
                </fieldset>
                {sessionLost && <h2 id="editor-session-title">Sesión desconectada</h2>}
                <p className="form-error" id="form-error" role="alert" hidden={!error}>{error}</p>
                <button type="button" className="button secondary reconnect" hidden={!sessionLost}
                        onClick={onReconnect}>Reconectar Google Drive
                </button>
                <div className="dialog-actions">
                    <button type="button" className="button quiet" data-close onClick={handleClose}>
                        Cancelar
                    </button>
                    <button type="submit" className="button primary" id="save"
                            disabled={busy || sessionLost || checkingReport}>
                        {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Guardar estudio')}
                    </button>
                </div>
            </form>
        </dialog>
    );
}
