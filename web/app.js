import { analyzePdf, validatePdf } from './detect.js';
import { connect, connected, configured, disconnect, DriveSessionError, listStudies, reportURL, reserveId, saveStudy, trashStudy, viewerURL } from './drive.js';

const $ = (selector, root = document) => root.querySelector(selector);
const editor = $('#editor');
const editorForm = $('#editor-form');
const fields = editorForm.elements;
const confirmDialog = $('#confirm');
const filters = $('#filters');
const search = $('#search');
const results = $('#results');
const empty = $('#empty');
const emptyAction = $('#empty-action');
const listStatus = $('#list-status');
const count = $('#count');
let records = [];
let editing = null;
let deleting = null;
let loaded = false;
let loadSequence = 0;
let pendingId = '';
let analysis = null;
const suggested = new Map();
const touched = new Set();
const detectable = ['date', 'type', 'doctor', 'title'];

const dateLabel = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });
const normalize = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

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
    errorBox.textContent = error.message;
    errorBox.hidden = false;
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
    const list = await listStudies();
    if (sequence !== loadSequence) return;
    records = list;
    loaded = true;
    render();
  } catch (error) {
    if (sequence !== loadSequence) return;
    if (error instanceof DriveSessionError && !editor.open && !confirmDialog.open) {
      setAccess(false);
      return;
    }
    if (!loaded) listStatus.hidden = true;
    $('#load-error-message').textContent = error.message;
    $('#load-error').hidden = false;
  }
}

function render() {
  if (!loaded) return;
  const query = normalize(search.value.trim());
  const type = $('#type').value;
  const from = $('#from').value;
  const to = $('#to').value;
  const filtered = Boolean(query || type || from || to);
  const invalidRange = Boolean(from && to && from > to);
  const matches = invalidRange ? [] : records.filter((study) =>
    (!query || normalize([study.title, study.doctor, study.portal].join(' ')).includes(query)) &&
    (!type || study.type === type) &&
    (!from || study.date >= from) &&
    (!to || study.date <= to)
  ).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR'));

  $('#clear').hidden = !filtered;
  count.hidden = false;
  count.textContent = records.length;
  listStatus.hidden = !filtered;
  listStatus.textContent = invalidRange
    ? 'La fecha «Hasta» debe ser igual o posterior a «Desde».'
    : matches.length + (matches.length === 1 ? ' estudio encontrado' : ' estudios encontrados');
  results.replaceChildren(...matches.map(recordRow));
  results.hidden = !matches.length;
  empty.hidden = Boolean(matches.length);
  $('#empty-title').textContent = filtered ? 'No hay estudios con esos filtros' : 'Tu archivo empieza acá';
  $('#empty-copy').textContent = filtered
    ? 'Probá con otras fechas, otro tipo de estudio o una búsqueda distinta.'
    : 'Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos.';
  emptyAction.innerHTML = filtered
    ? 'Limpiar filtros'
    : '<svg class="icon"><use href="#i-plus"/></svg> Agregar estudio';
  emptyAction.dataset.filtered = String(filtered);
}

function recordRow(study) {
  const row = $('#record').content.firstElementChild.cloneNode(true);
  $('.record-title', row).textContent = study.title;
  $('.record-portal', row).textContent = study.portal;
  $('.record-doctor', row).textContent = study.doctor;
  $('.type-badge', row).textContent = study.type;
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

function openEditor(study = null) {
  editing = study;
  pendingId = '';
  suggested.clear();
  touched.clear();
  editorForm.reset();
  status('Buscamos la fecha, el tipo y el médico en el PDF.');
  $('.reconnect', editor).hidden = true;
  $('#form-error').hidden = true;
  $('#editor-title').textContent = study ? 'Editar estudio' : 'Agregar estudio';
  $('#current-report').hidden = !study?.reportName;
  $('#current-report-name').textContent = study?.reportName || '';
  if (study) {
    for (const field of ['title', 'date', 'type', 'doctor', 'portal', 'viewer']) fields[field].value = study[field];
  }
  editor.showModal();
  (study ? fields.title : fields.report).focus();
}

function status(message, state = '') {
  const detection = $('#detection');
  detection.textContent = message;
  detection.dataset.state = state;
}

for (const name of detectable) {
  fields[name].addEventListener('input', () => {
    suggested.delete(name);
    touched.add(name);
  });
}

editor.addEventListener('close', () => {
  if (!editor.open) analysis?.abort();
});
fields.report.addEventListener('change', async () => {
  analysis?.abort();
  for (const [name, value] of suggested) {
    if (fields[name].value === value) fields[name].value = '';
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
    if (found.type) found.title = found.type;
    const labels = { date: 'fecha', type: 'tipo', doctor: 'médico' };
    const applied = [];
    for (const name of detectable) {
      if (found[name] && !fields[name].value && !touched.has(name)) {
        fields[name].value = found[name];
        suggested.set(name, found[name]);
        if (labels[name]) applied.push(labels[name]);
      }
    }
    const missing = Object.keys(labels).filter((name) => !fields[name].value).map((name) => labels[name]);
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
for (const dialog of [editor, confirmDialog]) {
  dialog.addEventListener('cancel', (event) => {
    if (dialog.dataset.busy === 'true') event.preventDefault();
  });
}
for (const event of ['input', 'change']) filters.addEventListener(event, render);
filters.addEventListener('submit', (event) => event.preventDefault());
filters.addEventListener('reset', (event) => {
  event.preventDefault();
  for (const input of [search, $('#type'), $('#from'), $('#to')]) input.value = '';
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
  loaded = false;
  results.replaceChildren();
  listStatus.hidden = false;
  listStatus.textContent = 'Cargando tus estudios…';
  $('#access-error').hidden = true;
  setAccess(false);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && connected() && !editor.open && !confirmDialog.open) void load();
});

function busy(dialog, button, active, label) {
  dialog.dataset.busy = String(active);
  for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = active;
  button.textContent = label;
}

editorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const entry = Object.fromEntries(['title', 'date', 'type', 'doctor', 'portal', 'viewer'].map((name) => [name, fields[name].value.trim()]));
  const report = fields.report.files[0] || null;
  const removeReport = fields.removeReport.checked;
  const errorBox = $('#form-error');
  const save = $('#save');
  errorBox.hidden = true;
  busy(editor, save, true, 'Guardando…');
  try {
    if (!entry.title) throw new Error('Ingresá un nombre para el estudio.');
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
  busy(confirmDialog, button, true, 'Eliminando…');
  try {
    await trashStudy(deleting);
    ++loadSequence;
    records = records.filter((item) => item.id !== deleting.id);
    confirmDialog.close();
    render();
    await load();
  } catch (error) {
    showError(error, errorBox, confirmDialog);
  } finally {
    busy(confirmDialog, button, false, 'Eliminar estudio');
  }
});

async function start() {
  for (const button of document.querySelectorAll('[data-add]')) button.disabled = true;
  try {
    const types = await fetch('./types.json').then((response) => response.json());
    for (const type of types) {
      $('#type').add(new Option(type, type));
      fields.type.add(new Option(type, type));
    }
    for (const button of document.querySelectorAll('[data-add]')) button.disabled = false;
    if (!configured) {
      $('#connect').disabled = true;
      $('#access-copy').textContent = 'Para abrir el archivo, primero hay que configurar el acceso a Google Drive.';
    }
  } catch {
    $('#connect').disabled = true;
    $('#access-copy').textContent = 'No se pudo cargar la página. Actualizala para volver a intentar.';
  }
}
start();
