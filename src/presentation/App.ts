/**
 * Page controller. Same behavior as the original web/app.js, on top of the typed repositories:
 * the list, filters, editor (with automatic PDF reading) and the delete confirmation.
 * Auth state drives the screen: connecting loads the studies, disconnecting returns to the access screen.
 */
import { DriveConflictError, DriveSessionError, driveAuth, driveStudyRepo } from '@data';
import { analyzePdf, validatePdf } from '@data/pdf-analysis';
import { filterStudies, portalNames, reportUrl } from '@domain/library';
import type { Study, StudyDraft } from '@domain/models';
import { getStudyTypes, viewerURL } from '@domain/utils';

function createStudyCardSkeleton(): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'record skeleton-card';

  li.innerHTML = `
    <div class="record-main">
      <div class="skeleton skeleton-icon"></div>
      <div class="record-text">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-subtitle"></div>
      </div>
      <div class="type-badges">
        <div class="skeleton skeleton-badge"></div>
        <div class="skeleton skeleton-badge skeleton-badge-short"></div>
      </div>
    </div>
    <div class="record-controls">
      <div class="record-links">
        <div class="skeleton skeleton-link"></div>
      </div>
      <div class="record-actions">
        <div class="skeleton skeleton-action"></div>
        <div class="skeleton skeleton-action"></div>
      </div>
    </div>
  `;

  return li;
}

type DetectableField = 'date' | 'types' | 'doctor' | 'title';
const DETECTABLE: DetectableField[] = ['date', 'types', 'doctor', 'title'];
const TEXT_FIELDS = ['title', 'date', 'doctor', 'portal', 'viewer'] as const;
const ANALYSIS_TIMEOUT_MS = 45_000;
const SKELETON_ROWS = 5;

const dateLabel = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });

function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Element ${selector} not found`);
  return element;
}

export class App {
  private readonly editor = $<HTMLDialogElement>('#editor');
  private readonly editorForm = $<HTMLFormElement>('#editor-form');
  private readonly typeOptions = $('#study-types');
  private readonly portalOptions = $('#portal-options');
  private readonly portalChoices = $<HTMLDetailsElement>('#portal-choices');
  private readonly confirmDialog = $<HTMLDialogElement>('#confirm');
  private readonly filters = $<HTMLFormElement>('#filters');
  private readonly search = $<HTMLInputElement>('#search');
  private readonly results = $('#results');
  private readonly empty = $('#empty');
  private readonly emptyAction = $('#empty-action');
  private readonly listStatus = $('#list-status');
  private readonly count = $('#count');

  private records: Study[] = [];
  private loaded = false;
  private loadSequence = 0;
  /** Study open in the editor (null when creating) and the one awaiting delete confirmation. */
  private editing: Study | null = null;
  private deleting: Study | null = null;
  /** Id reserved for the study being created; kept across retries so a repeated save cannot duplicate it. */
  private pendingId = '';
  /** PDF reading in progress; aborted when the file changes or the editor closes. */
  private analysis: AbortController | null = null;
  /** Values the analysis put in the form (JSON), so changing the PDF can take back what it suggested. */
  private readonly suggested = new Map<DetectableField, string>();
  /** Fields the user touched by hand: the analysis never overwrites them. */
  private readonly touched = new Set<DetectableField>();

  mount(): void {
    this.wire();
    void this.start();
  }

  // ---------------------------------------------------------------- startup and access

  private async start(): Promise<void> {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-add]')) button.disabled = true;
    try {
      const types = await getStudyTypes();
      for (const type of types) {
        $<HTMLSelectElement>('#type').add(new Option(type, type));
        const label = document.createElement('label');
        label.className = 'type-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'types';
        input.value = type;
        const text = document.createElement('span');
        text.textContent = type;
        label.append(input, text);
        this.typeOptions.append(label);
      }
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-add]')) button.disabled = false;
      if (!driveAuth.configured) {
        $<HTMLButtonElement>('#connect').disabled = true;
        $('#access-copy').textContent = 'Para abrir el archivo, primero hay que configurar el acceso a Google Drive.';
      } else {
        driveAuth.restoreSession(); // a valid stored session reports "signed in" through onAuthChange
      }
    } catch {
      $<HTMLButtonElement>('#connect').disabled = true;
      $('#access-copy').textContent = 'No se pudo cargar la página. Actualizala para volver a intentar.';
    }
  }

  private setAccess(active: boolean): void {
    $('#access').hidden = active;
    $('#library').hidden = !active;
    $('#signout').hidden = !active;
    for (const button of document.querySelectorAll<HTMLElement>('[data-add]')) button.hidden = !active;
  }

  private dialogOpen(): boolean {
    return this.editor.open || this.confirmDialog.open;
  }

  private onAuthChange(signedIn: boolean): void {
    if (signedIn) {
      this.setAccess(true);
      void this.load();
    } else if (!this.dialogOpen()) {
      // With a dialog open the user keeps their place; the dialog offers "Reconectar" instead.
      this.resetLibrary();
    }
  }

  private resetLibrary(): void {
    this.loadSequence += 1;
    this.records = [];
    this.updatePortalOptions();
    this.loaded = false;
    this.results.replaceChildren();
    this.listStatus.hidden = false;
    this.listStatus.textContent = 'Cargando tus estudios…';
    $('#access-error').hidden = true;
    this.setAccess(false);
  }

  private async authorize(button: HTMLButtonElement): Promise<void> {
    const dialog = button.closest('dialog');
    const errorBox = dialog ? $('.form-error', dialog) : $('#access-error');
    errorBox.hidden = true;
    button.disabled = true;
    try {
      await driveAuth.signIn(); // onAuthChange shows the library and loads the studies
      button.hidden = Boolean(dialog);
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : 'No se pudo conectar con Google Drive.';
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------- list

  private async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    $('#load-error').hidden = true;
    if (!this.loaded) this.showSkeleton();
    try {
      // Always ask Drive: this is also how changes made on another device show up.
      const list = await driveStudyRepo.list({ force: true });
      if (sequence !== this.loadSequence) return;
      this.records = list;
      this.updatePortalOptions();
      this.loaded = true;
      this.render();
    } catch (error) {
      if (sequence !== this.loadSequence) return;
      if (error instanceof DriveSessionError && !this.dialogOpen()) {
        this.setAccess(false);
        return;
      }
      if (!this.loaded) {
        this.listStatus.hidden = true;
        this.results.replaceChildren();
        this.results.hidden = true;
      }
      $('#load-error-message').textContent = error instanceof Error ? error.message : 'Error desconocido';
      $('#load-error').hidden = false;
    }
  }

  private showSkeleton(): void {
    this.listStatus.textContent = 'Cargando tus estudios…';
    this.listStatus.hidden = false;
    this.empty.hidden = true;
    this.results.replaceChildren(...Array.from({ length: SKELETON_ROWS }, createStudyCardSkeleton));
    this.results.hidden = false;
  }

  private render(): void {
    if (!this.loaded) return;
    const { matches, filtered, invalidRange } = filterStudies(this.records, {
      query: this.search.value,
      type: $<HTMLSelectElement>('#type').value,
      from: $<HTMLInputElement>('#from').value,
      to: $<HTMLInputElement>('#to').value,
    });

    $('#clear').hidden = !filtered;
    this.count.hidden = false;
    this.count.textContent = String(this.records.length);
    this.listStatus.hidden = !filtered;
    this.listStatus.textContent = invalidRange
      ? 'La fecha «Hasta» debe ser igual o posterior a «Desde».'
      : `${matches.length} ${matches.length === 1 ? 'estudio encontrado' : 'estudios encontrados'}`;
    this.results.replaceChildren(...matches.map((study) => this.recordRow(study)));
    this.results.hidden = !matches.length;
    this.empty.hidden = Boolean(matches.length);
    $('#empty-title').textContent = filtered ? 'No hay estudios con esos filtros' : 'Tu archivo empieza acá';
    $('#empty-copy').textContent = filtered
      ? 'Probá con otras fechas, otro tipo de estudio o una búsqueda distinta.'
      : 'Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos.';
    if (filtered) this.emptyAction.replaceChildren('Limpiar filtros');
    else {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'icon');
      icon.innerHTML = '<use href="#i-plus"/>'; // constant markup, no user data
      this.emptyAction.replaceChildren(icon, ' Agregar estudio');
    }
    this.emptyAction.dataset.filtered = String(filtered);
  }

  private recordRow(study: Study): HTMLElement {
    const template = $<HTMLTemplateElement>('#record');
    const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    row.dataset.id = study.id;
    $('.record-title', row).textContent = study.title;
    $('.record-portal', row).textContent = study.portal;
    $('.record-doctor', row).textContent = study.doctor;
    $('.type-badges', row).replaceChildren(
      ...study.types.map((type) => {
        const badge = document.createElement('span');
        badge.className = 'type-badge';
        badge.textContent = type;
        return badge;
      })
    );
    const time = $<HTMLTimeElement>('time', row);
    time.dateTime = study.date;
    time.textContent = dateLabel.format(new Date(study.date));
    if (study.hasPdf) {
      const link = $<HTMLAnchorElement>('.pdf-link', row);
      link.href = reportUrl(study.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.hidden = false;
    }
    if (study.viewer) {
      const link = $<HTMLAnchorElement>('.viewer-link', row);
      link.href = study.viewer;
      link.hidden = false;
    }
    $('.no-attachment', row).hidden = Boolean(study.hasPdf || study.viewer);
    const edit = $('.edit', row);
    edit.setAttribute('aria-label', `Editar ${study.title}`);
    edit.addEventListener('click', () => this.openEditor(study));
    const remove = $('.remove', row);
    remove.setAttribute('aria-label', `Eliminar ${study.title}`);
    remove.addEventListener('click', () => this.openDeleteConfirm(study));
    return row;
  }

  private updatePortalOptions(): void {
    const names = portalNames(this.records);
    this.portalOptions.replaceChildren(
      ...names.map((name) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = name;
        button.addEventListener('click', () => {
          const input = this.field('portal');
          input.value = name;
          this.portalChoices.open = false;
          input.focus();
        });
        item.append(button);
        return item;
      })
    );
    this.portalChoices.hidden = !names.length;
    if (!names.length) this.portalChoices.open = false;
  }

  // ---------------------------------------------------------------- editor

  private field(name: string): HTMLInputElement {
    return this.editorForm.elements.namedItem(name) as HTMLInputElement;
  }

  private fieldValue(name: DetectableField): string | string[] {
    return name === 'types'
      ? [...this.typeOptions.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value)
      : this.field(name).value;
  }

  private setFieldValue(name: DetectableField, value: string | string[]): void {
    if (name === 'types') {
      for (const input of this.typeOptions.querySelectorAll<HTMLInputElement>('input')) {
        input.checked = value.includes(input.value);
      }
      this.validateTypes();
    } else {
      this.field(name).value = String(value);
    }
  }

  private isEmpty(name: DetectableField): boolean {
    return this.fieldValue(name).length === 0;
  }

  /** Native validation message on the first checkbox, so the browser blocks a save with no type chosen. */
  private validateTypes(): void {
    this.typeOptions
      .querySelector<HTMLInputElement>('input')
      ?.setCustomValidity(this.fieldValue('types').length ? '' : 'Elegí al menos un tipo de estudio.');
  }

  private status(message: string, state = ''): void {
    const detection = $('#detection');
    detection.textContent = message;
    detection.dataset.state = state;
  }

  private openEditor(study: Study | null = null): void {
    this.editing = study;
    this.pendingId = '';
    this.analysis?.abort();
    this.suggested.clear();
    this.touched.clear();
    this.editorForm.reset();
    this.portalChoices.open = false;
    this.status('Buscamos la fecha, los tipos y el médico en el PDF.');
    $('.reconnect', this.editor).hidden = true;
    $('#form-error').hidden = true;
    $('#editor-title').textContent = study ? 'Editar estudio' : 'Agregar estudio';
    $('#current-report').hidden = !study?.reportName;
    $('#current-report-name').textContent = study?.reportName || '';
    if (study) for (const name of TEXT_FIELDS) this.field(name).value = study[name];
    this.setFieldValue('types', study?.types || []);
    this.editor.showModal();
    // New studies start from the PDF (the date stays empty so the reading can fill it); edits start at the title.
    (study ? this.field('title') : this.field('report')).focus();
  }

  /** Reads the chosen PDF and fills the empty fields the user has not touched. Never overwrites manual input. */
  private async analyzeReport(): Promise<void> {
    this.analysis?.abort();
    // Take back what a previous PDF suggested, unless the user has changed it since.
    for (const [name, value] of this.suggested) {
      if (JSON.stringify(this.fieldValue(name)) === value) this.setFieldValue(name, name === 'types' ? [] : '');
    }
    this.suggested.clear();

    const input = this.field('report');
    const file = input.files?.[0];
    if (!file) {
      this.status('Podés adjuntar un PDF o completar la ficha manualmente.');
      return;
    }

    const controller = new AbortController();
    this.analysis = controller;
    const { signal } = controller;
    const active = () => this.editor.open && this.analysis === controller && !signal.aborted;
    const timeout = setTimeout(() => {
      controller.abort();
      if (this.analysis === controller && this.editor.open) {
        this.status('La lectura tardó demasiado. Podés completar los campos y guardar el PDF.');
      }
    }, ANALYSIS_TIMEOUT_MS);

    this.status('Leyendo el informe…');
    try {
      await validatePdf(file);
    } catch (error) {
      clearTimeout(timeout);
      if (active()) {
        input.value = '';
        this.status(error instanceof Error ? error.message : 'Elegí un archivo PDF válido.', 'error');
      }
      return;
    }

    try {
      const found = await analyzePdf(file, signal, () => {
        if (active()) this.status('Leyendo el texto de una imagen. Puede demorar unos segundos…');
      });
      if (!active()) return;

      const detected: Partial<Record<DetectableField, string | string[]>> = { ...found };
      if (found.types?.length) {
        detected.title = new Intl.ListFormat('es').format(
          found.types.map((type, i) => (i && type !== type.toUpperCase() ? type[0]!.toLowerCase() + type.slice(1) : type))
        );
      }
      const labels: Partial<Record<DetectableField, string>> = { date: 'fecha', types: 'tipos', doctor: 'médico' };
      const applied: string[] = [];
      for (const name of DETECTABLE) {
        const value = detected[name];
        if (value?.length && this.isEmpty(name) && !this.touched.has(name)) {
          this.setFieldValue(name, value);
          this.suggested.set(name, JSON.stringify(this.fieldValue(name)));
          const label = labels[name];
          if (label) applied.push(label);
        }
      }
      const missing = (Object.keys(labels) as DetectableField[]).filter((name) => this.isEmpty(name)).map((n) => labels[n]!);
      const review = applied.length ? `Revisá ${new Intl.ListFormat('es').format(applied)}. ` : '';
      this.status(review + (missing.length ? 'Completá los campos que falten.' : 'Podés editar los datos antes de guardar.'), 'review');
    } catch {
      if (active()) this.status('No pudimos leer el informe. Podés completar los campos y guardar el PDF.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async saveStudy(): Promise<void> {
    const draft: StudyDraft = {
      title: this.field('title').value.trim(),
      date: this.field('date').value.trim(),
      doctor: this.field('doctor').value.trim(),
      portal: this.field('portal').value.trim(),
      viewer: this.field('viewer').value.trim(),
      types: this.fieldValue('types') as string[],
      reportName: '',
    };
    const report = this.field('report').files?.[0] ?? null;
    const errorBox = $('#form-error');
    const save = $<HTMLButtonElement>('#save');
    errorBox.hidden = true;
    this.busy(this.editor, save, true, 'Guardando…');

    if (!draft.title) {
      this.showError(new Error('Ingresá un nombre para el estudio.'), errorBox, this.editor);
      this.busy(this.editor, save, false, 'Guardar estudio');
      return;
    }
    if (!draft.types.length) {
      this.showError(new Error('Elegí al menos un tipo de estudio.'), errorBox, this.editor);
      this.busy(this.editor, save, false, 'Guardar estudio');
      return;
    }
    try {
      draft.viewer = viewerURL(draft.viewer);
    } catch {
      this.showError(new Error('Pegá un enlace al visor que empiece con https:// o http://.'), errorBox, this.editor);
      this.busy(this.editor, save, false, 'Guardar estudio');
      return;
    }

    try {
      if (report) {
        await validatePdf(report);
        draft.file = report;
        draft.reportName = report.name;
      }
      draft.removeReport = this.field('removeReport').checked;
      if (this.editing) {
        draft.driveFileId = this.editing.id;
        draft.revision = this.editing.revision;
      } else {
        this.pendingId ||= await driveStudyRepo.reserveId();
        draft.id = this.pendingId;
      }

      const study = await driveStudyRepo.save(draft);
      this.loadSequence += 1; // a list request started before this save must not undo it
      const isNew = !this.editing;
      this.records = [...this.records.filter((item) => item.id !== study.id), study];
      this.updatePortalOptions();
      this.editor.close();
      if (isNew) this.filters.reset();
      this.render();
      await this.load();
    } catch (error) {
      this.showError(error, errorBox, this.editor);
      // Someone else changed it: refresh the list behind the dialog so the next attempt starts clean.
      if (error instanceof DriveConflictError) void this.load();
    } finally {
      this.busy(this.editor, save, false, 'Guardar estudio');
    }
  }

  // ---------------------------------------------------------------- delete

  private openDeleteConfirm(study: Study): void {
    this.deleting = study;
    $('#delete-copy').textContent = `«${study.title}» se moverá a la papelera de Google Drive.`;
    $('#delete-error').hidden = true;
    $('.reconnect', this.confirmDialog).hidden = true;
    this.confirmDialog.showModal();
    $('.quiet', this.confirmDialog).focus();
  }

  private async deleteStudy(): Promise<void> {
    const study = this.deleting;
    if (!study) return;
    const errorBox = $('#delete-error');
    const button = $<HTMLButtonElement>('#delete');
    errorBox.hidden = true;
    this.busy(this.confirmDialog, button, true, 'Eliminando…');
    try {
      await driveStudyRepo.delete(study.id, study.revision);
      this.loadSequence += 1;
      this.records = this.records.filter((item) => item.id !== study.id);
      this.updatePortalOptions();
      this.confirmDialog.close();
      this.render();
      await this.load();
    } catch (error) {
      this.showError(error, errorBox, this.confirmDialog);
      if (error instanceof DriveConflictError) void this.load();
    } finally {
      this.busy(this.confirmDialog, button, false, 'Eliminar estudio');
    }
  }

  // ---------------------------------------------------------------- shared helpers

  /** While a request is in flight the dialog cannot be closed or edited. */
  private busy(dialog: HTMLDialogElement, button: HTMLButtonElement, active: boolean, label: string): void {
    dialog.dataset.busy = String(active);
    for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
      'button, input, select'
    )) {
      control.disabled = active;
    }
    button.textContent = label;
  }

  /** A lost Drive session offers "Reconectar"; any other failure is just shown. */
  private showError(error: unknown, errorBox: HTMLElement, dialog: HTMLElement): void {
    errorBox.textContent = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    errorBox.hidden = false;
    $('.reconnect', dialog).hidden = !(error instanceof DriveSessionError);
  }

  // ---------------------------------------------------------------- wiring

  private wire(): void {
    driveAuth.onAuthChange((signedIn) => this.onAuthChange(signedIn));

    for (const button of document.querySelectorAll('[data-add]')) button.addEventListener('click', () => this.openEditor());
    for (const button of document.querySelectorAll('[data-close]')) {
      button.addEventListener('click', () => button.closest('dialog')?.close());
    }
    for (const dialog of [this.editor, this.confirmDialog]) {
      dialog.addEventListener('cancel', (event) => {
        if (dialog.dataset.busy === 'true') event.preventDefault();
      });
    }
    this.editor.addEventListener('close', () => this.analysis?.abort());

    // Filters: the page never navigates, every change re-renders the list.
    for (const type of ['input', 'change']) this.filters.addEventListener(type, () => this.render());
    this.filters.addEventListener('submit', (event) => event.preventDefault());
    this.filters.addEventListener('reset', (event) => {
      event.preventDefault();
      for (const input of [this.search, $<HTMLInputElement>('#type'), $<HTMLInputElement>('#from'), $<HTMLInputElement>('#to')]) {
        input.value = '';
      }
      this.render();
    });
    this.search.addEventListener('input', () => this.render());
    this.emptyAction.addEventListener('click', () => {
      if (this.emptyAction.dataset.filtered === 'true') this.filters.reset();
      else this.openEditor();
    });

    $('#retry').addEventListener('click', () => void this.load());
    $('#connect').addEventListener('click', (event) => void this.authorize(event.currentTarget as HTMLButtonElement));
    for (const button of document.querySelectorAll<HTMLButtonElement>('.reconnect')) {
      button.addEventListener('click', () => void this.authorize(button));
    }
    $('#signout').addEventListener('click', () => void driveAuth.signOut()); // onAuthChange returns to the access screen

    // Coming back to the tab picks up changes made on another device.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && driveAuth.isSignedIn() && !this.dialogOpen()) void this.load();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement === document.body) {
        event.preventDefault();
        this.search.focus();
      }
    });

    for (const name of DETECTABLE) {
      (name === 'types' ? this.typeOptions : this.field(name)).addEventListener('input', () => {
        this.suggested.delete(name);
        this.touched.add(name);
        if (name === 'types') this.validateTypes();
      });
    }
    this.field('report').addEventListener('change', () => void this.analyzeReport());
    this.editorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.saveStudy();
    });
    $('#delete-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.deleteStudy();
    });
  }
}
