import { analyzePdf, validatePdf } from './detect.js';
import { validDate } from './extract.js';
import {
  connect, connected, configured, disconnect, DriveSessionError,
  listStudies, reportURL, reserveId, restoreSession, saveStudy, trashStudy, viewerURL,
  listOperations, saveOperation, trashOperation, unlinkStudyFromOperation,
  readPortals, writePortals,
} from './drive.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const editor = $('#editor');
const editorForm = $('#editor-form');
const fields = editorForm.elements;
const typeOptions = $('#study-types');
const portalOptions = $('#portal-options');
const portalChoices = $('#portal-choices');
const confirmDialog = $('#confirm');
const filters = $('#filters');
const search = $('#search');
const results = $('#results');
const empty = $('#empty');
const emptyAction = $('#empty-action');
const listStatus = $('#list-status');
const count = $('#count');

const operationEditor = $('#operation-editor');
const operationEditorForm = $('#operation-editor-form');
const operationFields = operationEditorForm.elements;
const operationDelete = $('#operation-editor-delete');
const operationSave = $('#operation-editor-save');

const viewChronology = $('#view-chronology');
const viewCategory = $('#view-category');
const viewPortals = $('#view-portals');
const viewOperations = $('#view-operations');

let records = [];
let operations = [];
let portals = [];
let portalsRevision = '';
let editing = null;
let deleting = null;
let deletingType = 'study';
let operationEditing = null;
let operationDeleting = null;
let loaded = false;
let loadSequence = 0;
let pendingId = '';
let pendingOperationId = '';
let analysis = null;
const suggested = new Map();
const touched = new Set();
const detectable = ['date', 'types', 'doctor', 'title'];
let view = 'chronology';

// --- Caché de metadatos (IndexedDB) para apertura rápida sin red ---
const DB_NAME = 'mis-estudios-cache';
const DB_VERSION = 1;
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { req.result.createObjectStore('meta', { keyPath: 'key' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
function dbGet(key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result && req.result.value);
    req.onerror = () => reject(req.error);
  }));
}
function dbSet(key, value) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    const req = tx.objectStore('meta').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

const dateLabel = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });
const normalize = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function fieldValue(name) {
  return name === 'types'
    ? [...typeOptions.querySelectorAll('input:checked')].map((input) => input.value)
    : fields[name].value;
}

function validateTypes() {
  const first = typeOptions.querySelector('input');
  first?.setCustomValidity(fieldValue('types').length ? '' : 'Elegí al menos un tipo de estudio.');
}

function setFieldValue(name, value) {
  if (name === 'types') {
    for (const input of typeOptions.querySelectorAll('input')) input.checked = value.includes(input.value);
    validateTypes();
  } else if (name === 'operationId') {
    fields.operationId.value = value || '';
  } else fields[name].value = value;
}

function updatePortalOptions() {
  const names = new Map();
  for (const study of records) {
    if (typeof study.portal !== 'string') continue;
    const name = study.portal.trim().replace(/\s+/g, ' ');
    if (name && !names.has(normalize(name))) names.set(normalize(name), name);
  }
  const sorted = [...names.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  portalOptions.replaceChildren(...sorted.map((name) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => {
      fields.portal.value = name;
      portalChoices.open = false;
      fields.portal.focus();
    });
    item.append(button);
    return item;
  }));
  portalChoices.hidden = !sorted.length;
  if (!sorted.length) portalChoices.open = false;
  updateFilterPortalOptions(sorted);
}

function updateOperationOptions() {
  const select = $('#filter-operation');
  const editorSelect = fields.operationId;
  const current = select.value;
  const editorCurrent = editorSelect.value;
  select.replaceChildren(new Option('Todas las operaciones', ''));
  editorSelect.replaceChildren(new Option('Ninguna', ''));
  for (const operation of [...operations].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'))) {
    const option = new Option(operation.title + ' (' + dateLabel.format(new Date(operation.date)) + ')', operation.id);
    select.append(option);
    editorSelect.append(new Option(operation.title, operation.id));
  }
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
  if (editorCurrent && [...editorSelect.options].some((o) => o.value === editorCurrent)) editorSelect.value = editorCurrent;
}

function buildPortalDirectory() {
  const byName = new Map();
  for (const study of records) {
    const name = (study.portal || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, { name, url: '', notes: '', count: 0 });
    byName.get(name).count += 1;
  }
  for (const portal of portals) {
    if (byName.has(portal.name)) {
      Object.assign(byName.get(portal.name), { url: portal.url || '', notes: portal.notes || '' });
    } else {
      byName.set(portal.name, { name: portal.name, url: portal.url || '', notes: portal.notes || '', count: 0 });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

function setAccess(active) {
  $('#access').hidden = active;
  $('#library').hidden = !active;
  $('#signout').hidden = !active;
  for (const button of document.querySelectorAll('[data-add]')) button.hidden = !active;
}

async function authorize(button) {
  const dialog = button.closest('dialog');
  const errorBox = dialog ? $('.form-error', dialog) : $('#access-error');
  errorBox.hidden = true;
  button.disabled = true;
  try {
    await connect();
    button.hidden = Boolean(dialog);
    setAccess(true);
    await load();
  } catch (error) {
    showError(error, errorBox, dialog);
  } finally {
    button.disabled = false;
  }
}

function showError(error, errorBox, dialog) {
  errorBox.textContent = error.message;
  errorBox.hidden = false;
  $('.reconnect', dialog).hidden = !(error instanceof DriveSessionError);
}

async function load() {
  const sequence = ++loadSequence;
  $('#load-error').hidden = true;
  try {
    const [list, ops, portalDir] = await Promise.all([listStudies(), listOperations(), readPortals()]);
    if (sequence !== loadSequence) return;
    records = list;
    operations = ops;
    portals = portalDir.portals;
    portalsRevision = portalDir.revision;
    void dbSet('library', { records, operations, portals, portalsRevision, timestamp: Date.now() });
    updatePortalOptions();
    updateOperationOptions();
    loaded = true;
    render();
    return;
  } catch (error) {
    if (sequence !== loadSequence) return;
    const cached = await dbGet('library').catch(() => null);
    if (cached) {
      records = cached.records || [];
      operations = cached.operations || [];
      portals = cached.portals || [];
      portalsRevision = cached.portalsRevision || '';
      updatePortalOptions();
      updateOperationOptions();
      loaded = true;
      listStatus.hidden = false;
      listStatus.textContent = 'Sin conexión: mostrá el archivo en caché de la última sincronización.';
      render();
      return;
    }
    if (error instanceof DriveSessionError && !editor.open && !operationEditor.open && !confirmDialog.open) {
      setAccess(false);
      return;
    }
    if (!loaded) listStatus.hidden = true;
    $('#load-error-message').textContent = error.message;
    $('#load-error').hidden = false;
  }
}

function filterStudies() {
  const query = normalize(search.value.trim());
  const type = $('#type').value;
  const from = $('#from').value;
  const to = $('#to').value;
  const operation = $('#filter-operation').value;
  const portal = $('#filter-portal').value;
  const onlyPdf = $('#filter-pdf').checked;
  const onlyViewer = $('#filter-viewer').checked;
  const invalidRange = Boolean(from && to && from > to);
  if (invalidRange) return { matches: [], invalidRange: true };
  const matches = records.filter((study) =>
    (!query || normalize([study.title, study.doctor, study.portal].join(' ')).includes(query)) &&
    (!type || study.types.includes(type)) &&
    (!from || study.date >= from) &&
    (!to || study.date <= to) &&
    (!operation || study.operationId === operation) &&
    (!portal || study.portal === portal) &&
    (!onlyPdf || Boolean(study.reportName)) &&
    (!onlyViewer || Boolean(study.viewer))
  );
  return { matches, invalidRange: false };
}

function orderStudies(matches, order) {
  return [...matches].sort((a, b) => {
    if (order === 'date-desc') return b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR');
    if (order === 'date-asc') return a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'es-AR');
    return a.title.localeCompare(b.title, 'es-AR') || b.date.localeCompare(a.date);
  });
}

function render() {
  if (!loaded) return;
  const { matches, invalidRange } = filterStudies();
  const order = $('#filter-order').value;
  const ordered = orderStudies(matches, order);
  const query = normalize(search.value.trim());
  const filtered = Boolean(query || $('#type').value || $('#from').value || $('#to').value ||
    $('#filter-operation').value || $('#filter-portal').value || $('#filter-pdf').checked || $('#filter-viewer').checked);

  $('#clear').hidden = !filtered;
  count.hidden = false;
  count.textContent = records.length;

  showView(view);

  if (view === 'chronology' || view === 'category') {
    renderStudies(ordered, view === 'category');
  } else if (view === 'portals') {
    renderPortals();
  } else if (view === 'operations') {
    renderOperations();
  } else if (view === 'operation-detail') {
    renderOperationDetail();
  }

  listStatus.hidden = view !== 'chronology' && view !== 'category';
  if (listStatus.hidden === false) {
    listStatus.textContent = invalidRange
      ? 'La fecha «Hasta» debe ser igual o posterior a «Desde».'
      : ordered.length + (ordered.length === 1 ? ' estudio encontrado' : ' estudios encontrados');
  }
  if (view === 'chronology' || view === 'category') {
    $('#empty-title').textContent = filtered ? 'No hay estudios con esos filtros' : 'Tu archivo empieza acá';
    $('#empty-copy').textContent = filtered
      ? 'Probá con otras fechas, otro tipo de estudio o una búsqueda distinta.'
      : 'Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos.';
    emptyAction.innerHTML = filtered
      ? 'Limpiar filtros'
      : '<svg class="icon"><use href="#i-plus"/></svg> Agregar estudio';
    emptyAction.dataset.filtered = String(filtered);
  }
}

function showView(name) {
  view = name;
  for (const button of $$('[data-view]')) {
    button.className = 'tab-button' + (button.dataset.view === name ? ' active' : '');
  }
  viewChronology.hidden = name !== 'chronology';
  viewCategory.hidden = name !== 'category';
  viewPortals.hidden = name !== 'portals';
  viewOperations.hidden = name !== 'operations';
  $('#view-operation-detail').hidden = name !== 'operation-detail';
  $('#load-error').hidden = true;
}

function recordRow(study) {
  const row = $('#record').content.firstElementChild.cloneNode(true);
  $('.record-title', row).textContent = study.title;
  $('.record-portal', row).textContent = study.portal;
  $('.record-doctor', row).textContent = study.doctor;
  $('.type-badges', row).replaceChildren(...study.types.map((type) => {
    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = type;
    return badge;
  }));
  const time = $('time', row);
  time.dateTime = study.date;
  time.textContent = dateLabel.format(new Date(study.date));
  if (study.reportName) {
    const link = $('.pdf-link', row);
    link.href = reportURL(study.id);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = false;
  }
  if (study.viewer) {
    const link = $('.viewer-link', row);
    link.href = study.viewer;
    link.hidden = false;
  }
  $('.no-attachment', row).hidden = Boolean(study.reportName || study.viewer);
  const edit = $('.edit', row);
  edit.setAttribute('aria-label', 'Editar ' + study.title);
  edit.addEventListener('click', () => openEditor(study));
  const remove = $('.remove', row);
  remove.setAttribute('aria-label', 'Eliminar ' + study.title);
  remove.addEventListener('click', () => {
    deleting = study;
    $('#delete-copy').textContent = '«' + study.title + '» se moverá a la papelera de Google Drive.';
    $('#delete-error').hidden = true;
    $('.reconnect', confirmDialog).hidden = true;
    confirmDialog.showModal();
    $('.quiet', confirmDialog).focus();
  });
  return row;
}

function renderStudies(matches, grouped) {
  const container = grouped ? $('#category-results') : results;
  const other = grouped ? results : $('#category-results');
  other.replaceChildren();
  other.hidden = true;
  if (!grouped) {
    results.replaceChildren(...matches.map(recordRow));
    results.hidden = !matches.length;
    empty.hidden = Boolean(matches.length);
    return;
  }
  const byType = new Map();
  for (const study of matches) {
    for (const type of study.types) {
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(study);
    }
  }
  const typesOrder = [...byType.keys()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const fragment = document.createDocumentFragment();
  for (const type of typesOrder) {
    const group = byType.get(type);
    const header = document.createElement('li');
    header.className = 'category-group';
    header.textContent = type + ' (' + group.length + ')';
    fragment.append(header);
    for (const study of group) fragment.append(recordRow(study));
  }
  container.replaceChildren(...fragment.children);
  container.hidden = !fragment.children.length;
  empty.hidden = !fragment.children.length;
}

function rowPortal(portal) {
  const row = document.createElement('li');
  row.className = 'record portal-row';
  row.innerHTML =
    '<div class="record-main"><div class="file-icon"><svg class="icon"><use href="#i-external"/></svg></div>' +
    '<div class="record-text"><h3 class="record-title">' + escapeHtml(portal.name) + '</h3>' +
    '<p class="record-meta"><span class="record-portal">' + escapeHtml(portal.url || 'Sin URL configurada') + '</span>' +
    (portal.notes ? ' <span class="portal-notes">' + escapeHtml(portal.notes) + '</span>' : '') +
    '</p></div><div class="type-badges"><span class="type-badge portal-count">' + portal.count + ' estudio' + (portal.count !== 1 ? 's' : '') + '</span></div></div>' +
    '<div class="record-controls"><div class="record-links">' +
    (portal.url ? '<a class="record-link portal-link" href="' + escapeHtml(portal.url) + '" target="_blank" rel="noopener noreferrer"><svg class="icon"><use href="#i-external"/></svg> Abrir portal</a>' : '') +
    '</div><div class="record-actions">' +
    '<button class="icon-button edit-portal" type="button" title="Editar portal"><svg class="icon"><use href="#i-edit"/></svg></button>' +
    '<button class="icon-button remove" type="button" title="Eliminar portal"><svg class="icon"><use href="#i-trash"/></svg></button>' +
    '</div></div></li>';
  $('.edit-portal', row).addEventListener('click', () => openPortalEditor(portal));
  $('.remove', row).addEventListener('click', () => {
    deleting = portal;
    deletingType = 'portal';
    $('#delete-copy').textContent = '«' + portal.name + '» se eliminará del directorio de portales.';
    $('#delete-error').hidden = true;
    confirmDialog.showModal();
    $('.quiet', confirmDialog).focus();
  });
  return row;
}

function renderPortals() {
  const directory = buildPortalDirectory();
  const container = $('#portals-results');
  container.replaceChildren(...directory.map(rowPortal));
  container.hidden = !directory.length;
  empty.hidden = Boolean(directory.length);
  results.hidden = true;
  $('#category-results').hidden = true;
  $('#operations-results').hidden = true;
}

function rowOperation(operation) {
  const linkedCount = records.filter((s) => s.operationId === operation.id).length;
  const row = document.createElement('li');
  row.className = 'record operation-row';
  row.innerHTML =
    '<div class="record-main"><div class="file-icon"><svg class="icon"><use href="#i-lock"/></svg></div>' +
    '<div class="record-text"><h3 class="record-title">' + escapeHtml(operation.title) + '</h3>' +
    '<p class="record-meta"><time datetime="' + escapeHtml(operation.date) + '">' + dateLabel.format(new Date(operation.date)) + '</time>' +
    (operation.surgeon ? ' <span class="record-doctor">' + escapeHtml(operation.surgeon) + '</span>' : '') +
    (operation.institution ? ' <span class="record-portal">' + escapeHtml(operation.institution) + '</span>' : '') +
    '</p></div><div class="type-badges"><span class="type-badge operation-count">' + linkedCount + ' estudio' + (linkedCount !== 1 ? 's' : '') + '</span></div></div>' +
    '<div class="record-controls"><div class="record-links">' +
    '<a class="record-link operation-link" href="#"><svg class="icon"><use href="#i-file"/></svg> Ver estudios</a>' +
    '</div><div class="record-actions">' +
    '<button class="icon-button edit-operation" type="button" title="Editar operación"><svg class="icon"><use href="#i-edit"/></svg></button>' +
    '<button class="icon-button remove" type="button" title="Eliminar operación"><svg class="icon"><use href="#i-trash"/></svg></button>' +
    '</div></div></li>';
  const viewLink = $('.operation-link', row);
  viewLink.addEventListener('click', (event) => {
    event.preventDefault();
    openOperationDetail(operation);
  });
  $('.edit-operation', row).addEventListener('click', () => openOperationEditor(operation));
  $('.remove', row).addEventListener('click', () => {
    operationDeleting = operation;
    deleting = operation;
    deletingType = 'operation';
    $('#delete-copy').textContent = '«' + operation.title + '» se moverá a la papelera de Google Drive.';
    $('#delete-error').hidden = true;
    confirmDialog.showModal();
    $('.quiet', confirmDialog).focus();
  });
  return row;
}

function renderOperations() {
  const ordered = [...operations].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'));
  const container = $('#operations-results');
  container.replaceChildren(...ordered.map(rowOperation));
  container.hidden = !ordered.length;
  empty.hidden = Boolean(ordered.length);
  results.hidden = true;
  $('#category-results').hidden = true;
  $('#portals-results').hidden = true;
}

function openOperationDetail(operation) {
  operationEditing = operation;
  const panel = $('#view-operation-detail');
  const container = $('#operation-detail-content');
  const linked = records.filter((study) => study.operationId === operation.id)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'));
  container.innerHTML =
    '<h2>' + escapeHtml(operation.title) + '</h2>' +
    '<p class="operation-meta"><time datetime="' + escapeHtml(operation.date) + '">' + dateLabel.format(new Date(operation.date)) + '</time>' +
    (operation.type ? ' · ' + escapeHtml(operation.type) : '') +
    (operation.surgeon ? ' · Dr./a ' + escapeHtml(operation.surgeon) : '') +
    (operation.institution ? ' · ' + escapeHtml(operation.institution) : '') +
    '</p>' +
    (operation.notes ? '<p class="operation-notes">' + escapeHtml(operation.notes) + '</p>' : '') +
    '<h3>Estudios vinculados (' + linked.length + ')</h3>' +
    (linked.length ? '<ul class="results operation-linked-list">' + linked.map((study) =>
      '<li class="record"><div class="record-main"><div class="file-icon"><svg class="icon"><use href="#i-file"/></svg></div>' +
      '<div class="record-text"><h3 class="record-title">' + escapeHtml(study.title) + '</h3>' +
      '<p class="record-meta"><time>' + dateLabel.format(new Date(study.date)) + '</time>' +
      (study.types.length ? ' <span class="record-doctor">' + study.types.join(' · ') + '</span>' : '') + '</p></div></div>' +
      '<div class="record-controls"><div class="record-links">' +
      (study.reportName ? '<a class="record-link pdf-link" href="' + escapeHtml(reportURL(study.id)) + '" target="_blank" rel="noopener noreferrer"><svg class="icon"><use href="#i-file"/></svg> Informe PDF</a>' : '') +
      (study.viewer ? '<a class="record-link viewer-link" href="' + escapeHtml(study.viewer) + '" target="_blank" rel="noopener noreferrer"><svg class="icon"><use href="#i-external"/></svg> Abrir visor</a>' : '') +
      '</div><div class="record-actions">' +
      '<button class="icon-button unlink" type="button" title="Desvincular estudio"><svg class="icon"><use href="#i-close"/></svg></button>' +
      '</div></div></li>').join('') + '</ul>' :
      '<p class="empty-hint">Aún no hay estudios vinculados a esta operación.</p>') +
    '<div class="dialog-actions" style="margin-top:14px">' +
    '<button class="button quiet" id="operation-detail-close">Cerrar</button>' +
    (linked.length ? '<button class="button secondary" id="operation-detail-unlink-all">Desvincular todos</button>' : '') +
    '</div>';
  $('#operation-detail-close').addEventListener('click', () => { render(); });
  $('#operation-detail-unlink-all')?.addEventListener('click', async () => {
    for (const study of linked) await unlinkStudyFromOperation(study, operation);
    render();
  });
  container.querySelectorAll('.unlink').forEach((button, index) => {
    button.addEventListener('click', async () => {
      await unlinkStudyFromOperation(linked[index], operation);
      openOperationDetail(operation);
    });
  });
  showView('operation-detail');
}

function renderOperationDetail() {
  if (!operationEditing) return;
  openOperationDetail(operationEditing);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function openEditor(study = null) {
  editing = study;
  pendingId = '';
  suggested.clear();
  touched.clear();
  editorForm.reset();
  portalChoices.open = false;
  status('Buscamos la fecha, los tipos y el médico en el PDF.');
  $('.reconnect', editor).hidden = true;
  $('#form-error').hidden = true;
  $('#editor-title').textContent = study ? 'Editar estudio' : 'Agregar estudio';
  $('#current-report').hidden = !study?.reportName;
  $('#current-report-name').textContent = study?.reportName || '';
  if (study) {
    for (const field of ['title', 'date', 'doctor', 'portal', 'viewer', 'operationId']) fields[field].value = study[field];
  }
  setFieldValue('types', study?.types || []);
  editor.showModal();
  (study ? fields.title : fields.report).focus();
}

function status(message, state = '') {
  const detection = $('#detection');
  detection.textContent = message;
  detection.dataset.state = state;
}

for (const name of detectable) {
  (name === 'types' ? typeOptions : fields[name]).addEventListener('input', () => {
    suggested.delete(name);
    touched.add(name);
    if (name === 'types') validateTypes();
  });
}

editor.addEventListener('close', () => {
  if (!editor.open) analysis?.abort();
});
fields.report.addEventListener('change', async () => {
  analysis?.abort();
  for (const [name, value] of suggested) {
    if (JSON.stringify(fieldValue(name)) === value) setFieldValue(name, name === 'types' ? [] : '');
  }
  suggested.clear();
  const file = fields.report.files[0];
  if (!file) {
    status('Podés adjuntar un PDF o completar la ficha manualmente.');
    return;
  }
  const controller = new AbortController();
  analysis = controller;
  const { signal } = controller;
  const timeout = setTimeout(() => {
    controller.abort();
    if (analysis === controller && editor.open) status('La lectura tardó demasiado. Podés completar los campos y guardar el PDF.');
  }, 45000);
  const active = () => editor.open && analysis === controller && !signal.aborted;
  status('Leyendo el informe…');
  try {
    await validatePdf(file);
  } catch (error) {
    clearTimeout(timeout);
    if (active()) {
      fields.report.value = '';
      status(error.message, 'error');
    }
    return;
  }
  try {
    const found = await analyzePdf(file, signal, () => {
      if (active()) status('Leyendo el texto de una imagen. Puede demorar unos segundos…');
    });
    if (!active()) return;
    if (found.types?.length) {
      found.title = new Intl.ListFormat('es').format(found.types.map((type, i) =>
        i && type !== type.toUpperCase() ? type[0].toLowerCase() + type.slice(1) : type));
    }
    const labels = { date: 'fecha', types: 'tipos', doctor: 'médico' };
    const applied = [];
    for (const name of detectable) {
      if (found[name]?.length && !fieldValue(name).length && !touched.has(name)) {
        setFieldValue(name, found[name]);
        suggested.set(name, JSON.stringify(fieldValue(name)));
        if (labels[name]) applied.push(labels[name]);
      }
    }
    const missing = Object.keys(labels).filter((name) => !fieldValue(name).length).map((name) => labels[name]);
    const review = applied.length ? 'Revisá ' + new Intl.ListFormat('es').format(applied) + '. ' : '';
    status(review + (missing.length ? 'Completá los campos que falten.' : 'Podés editar los datos antes de guardar.'), 'review');
  } catch {
    if (active()) status('No pudimos leer el informe. Podés completar los campos y guardar el PDF.');
  } finally {
    clearTimeout(timeout);
  }
});

for (const button of document.querySelectorAll('[data-add]')) button.addEventListener('click', () => openEditor());
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of [editor, confirmDialog, operationEditor]) {
  dialog.addEventListener('cancel', (event) => {
    if (dialog.dataset.busy === 'true') event.preventDefault();
  });
}
for (const event of ['input', 'change']) filters.addEventListener(event, render);
filters.addEventListener('submit', (event) => event.preventDefault());
filters.addEventListener('reset', (event) => {
  event.preventDefault();
  for (const input of [search, $('#type'), $('#from'), $('#to'), $('#filter-operation'), $('#filter-portal')]) input.value = '';
  $('#filter-pdf').checked = false;
  $('#filter-viewer').checked = false;
  render();
});
search.addEventListener('input', render);
emptyAction.addEventListener('click', () => {
  if (emptyAction.dataset.filtered === 'true') filters.reset();
  else openEditor();
});
$('#retry').addEventListener('click', load);
$('#connect').addEventListener('click', (event) => void authorize(event.currentTarget));
for (const button of document.querySelectorAll('.reconnect')) button.addEventListener('click', () => void authorize(button));
$('#signout').addEventListener('click', () => {
  disconnect();
  ++loadSequence;
  records = [];
  operations = [];
  portals = [];
  updatePortalOptions();
  updateOperationOptions();
  loaded = false;
  results.replaceChildren();
  $('#category-results').replaceChildren();
  $('#portals-results').replaceChildren();
  $('#operations-results').replaceChildren();
  listStatus.hidden = false;
  listStatus.textContent = 'Cargando tus estudios…';
  $('#access-error').hidden = true;
  setAccess(false);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && connected() && !editor.open && !operationEditor.open && !confirmDialog.open) void load();
});

function busy(dialog, button, active, label) {
  dialog.dataset.busy = String(active);
  for (const control of dialog.querySelectorAll('button, input, select, textarea')) control.disabled = active;
  button.textContent = label;
}

editorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const entry = Object.fromEntries(['title', 'date', 'doctor', 'portal', 'viewer', 'operationId'].map((name) => [name, fields[name].value.trim()]));
  entry.types = fieldValue('types');
  const report = fields.report.files[0] || null;
  const removeReport = fields.removeReport.checked;
  const errorBox = $('#form-error');
  const save = $('#save');
  errorBox.hidden = true;
  busy(editor, save, true, 'Guardando…');
  try {
    if (!entry.title) throw new Error('Ingresá un nombre para el estudio.');
    if (!entry.types.length) throw new Error('Elegí al menos un tipo de estudio.');
    try {
      entry.viewer = viewerURL(entry.viewer);
    } catch {
      throw new Error('Pegá un enlace al visor que empiece con https:// o http://.');
    }
    if (report) await validatePdf(report);
    if (!editing && !pendingId) pendingId = await reserveId();
    const study = await saveStudy({ entry, report, previous: editing, removeReport, newId: pendingId });
    ++loadSequence;
    const newRecord = !editing;
    records = [...records.filter((item) => item.id !== study.id), study];
    updatePortalOptions();
    updateOperationOptions();
    editor.close();
    if (newRecord) filters.reset();
    render();
    await load();
  } catch (error) {
    showError(error, errorBox, editor);
  } finally {
    busy(editor, save, false, 'Guardar estudio');
  }
});

$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('#delete-error');
  const button = $('#delete');
  errorBox.hidden = true;
  const target = deleting;
  const type = deletingType;
  busy(confirmDialog, button, true, 'Eliminando…');
  try {
    if (type === 'portal') {
      const updated = [...portals.filter((p) => p.name !== target.name)];
      const saved = await writePortals(updated);
      portals = updated;
      portalsRevision = saved.revision;
    } else if (type === 'operation') {
      await trashOperation(target);
      ++loadSequence;
      operations = operations.filter((item) => item.id !== target.id);
      updateOperationOptions();
    } else {
      await trashStudy(target);
      ++loadSequence;
      records = records.filter((item) => item.id !== target.id);
    }
    updatePortalOptions();
    confirmDialog.close();
    deleting = null;
    deletingType = 'study';
    render();
    await load();
  } catch (error) {
    showError(error, errorBox, confirmDialog);
  } finally {
    busy(confirmDialog, button, false, 'Eliminar estudio');
  }
});

// --- Operaciones (editor de operación) ---

function openOperationEditor(operation = null) {
  operationEditing = operation;
  pendingOperationId = '';
  operationEditorForm.reset();
  $('#operation-editor-title').textContent = operation ? 'Editar operación' : 'Nueva operación';
  operationDelete.hidden = !operation;
  if (operation) {
    for (const field of ['title', 'date', 'surgeon', 'institution', 'type', 'notes']) operationFields[field].value = operation[field] || '';
  }
  operationEditor.showModal();
  operationFields.title.focus();
}

function saveOperationForm() {
  return async (event) => {
    event.preventDefault();
    const entry = {
      title: operationFields.title.value.trim(),
      date: operationFields.date.value.trim(),
      surgeon: operationFields.surgeon.value.trim(),
      institution: operationFields.institution.value.trim(),
      type: operationFields.type.value.trim(),
      notes: operationFields.notes.value.trim(),
    };
    const errorBox = $('#operation-form-error');
    const button = operationSave;
    errorBox.hidden = true;
    busy(operationEditor, button, true, 'Guardando…');
    try {
      if (!entry.title) throw new Error('Ingresá un nombre para la operación.');
      if (!validDate(entry.date)) throw new Error('Ingresá una fecha válida.');
      if (!operationEditing && !pendingOperationId) pendingOperationId = await reserveId();
      const operation = await saveOperation({ entry, previous: operationEditing, newId: pendingOperationId });
      ++loadSequence;
      const newRecord = !operationEditing;
      operations = [...operations.filter((item) => item.id !== operation.id), operation];
      updateOperationOptions();
      operationEditor.close();
      if (newRecord) pendingOperationId = '';
      render();
      await load();
    } catch (error) {
      showError(error, errorBox, operationEditor);
    } finally {
      busy(operationEditor, button, false, 'Guardar operación');
    }
  };
}

operationEditorForm.addEventListener('submit', saveOperationForm());

operationDelete.addEventListener('click', async (event) => {
  event.preventDefault();
  const errorBox = $('#operation-form-error');
  const button = operationDelete;
  errorBox.hidden = true;
  const target = operationEditing;
  if (!target) return;
  if (records.some((s) => s.operationId === target.id)) {
    errorBox.textContent = 'No se puede eliminar una operación con estudios vinculados. Desvinculalos primero.';
    errorBox.hidden = false;
    return;
  }
  busy(operationEditor, button, true, 'Eliminando…');
  try {
    await trashOperation(target);
    ++loadSequence;
    operations = operations.filter((item) => item.id !== target.id);
    updateOperationOptions();
    operationEditor.close();
    render();
    await load();
  } catch (error) {
    showError(error, errorBox, operationEditor);
  } finally {
    operationEditing = null;
    busy(operationEditor, button, false, 'Eliminar operación');
  }
});

document.getElementById('editor-operation-create')?.addEventListener('click', () => openOperationEditor());

// --- Portales (directorio) ---

async function openPortalEditor(portal = null) {
  const name = portal ? portal.name : '';
  const url = portal ? portal.url : '';
  const notes = portal ? portal.notes : '';
  const newName = prompt('Nombre de la institución o portal', name);
  if (newName === null || !newName.trim()) return;
  const newUrl = prompt('URL del portal (https://…)', url);
  if (newUrl === null) return;
  const newNotes = prompt('Notas (opcional)', notes);
  if (newNotes === null) return;
  try {
    const updated = [...portals.filter((p) => p.name !== name), { name: newName.trim(), url: newUrl.trim() || '', notes: newNotes.trim() || '' }];
    const saved = await writePortals(updated);
    portals = updated;
    portalsRevision = saved.revision;
    render();
    await load();
  } catch (error) {
    alert('No se pudo guardar el portal: ' + error.message);
  }
}

// --- Inicio ---

async function start() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  for (const button of document.querySelectorAll('[data-add]')) button.disabled = true;
  try {
    const types = await fetch('./types.json').then((response) => response.json());
    for (const type of types) {
      $('#type').add(new Option(type, type));
      const label = document.createElement('label');
      label.className = 'type-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'types';
      input.value = type;
      const text = document.createElement('span');
      text.textContent = type;
      label.append(input, text);
      typeOptions.append(label);
    }
    for (const button of document.querySelectorAll('[data-add]')) button.disabled = false;
    if (!configured) {
      $('#connect').disabled = true;
      $('#access-copy').textContent = 'Para abrir el archivo, primero hay que configurar el acceso a Google Drive.';
    } else if (restoreSession()) {
      setAccess(true);
      await load();
    }
  } catch {
    $('#connect').disabled = true;
    $('#access-copy').textContent = 'No se pudo cargar la página. Actualizala para volver a intentar.';
  }

  for (const button of $$('[data-view]')) {
    button.addEventListener('click', (event) => {
      const name = event.currentTarget.dataset.view;
      if (name === view) return;
      showView(name);
      render();
    });
  }
}

start();
