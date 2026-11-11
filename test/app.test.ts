/**
 * Runs the real App against the real index.html. Unit tests of the repositories cannot notice a broken page:
 * these catch wiring mistakes (missing elements, handlers that never match, lists hidden after loading) and hold the
 * behaviour of the original app.js: list, filters, editor, save, delete, conflicts and lost sessions.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { addRemoteStudy, clearFakeDrive, fakeDriveFile, resetFakeDrive, SEED_PDF_ID, touchRemote } from './fake-drive';
import { $, closeDialogs, mountPage, reloadLibrary, rowIds, text, TYPES, typeInto } from './page';
import { server } from './server';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const field = (name: string) => $<HTMLInputElement>(`#editor-form [name="${name}"]`);
const row = (id: string) => $<HTMLLIElement>(`#results li[data-id="${id}"]`);
const edit = (id: string) => row(id).querySelector<HTMLButtonElement>('.edit')!.click();
const submitEditor = () => $<HTMLFormElement>('#editor-form').requestSubmit();
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(() => mountPage());

beforeEach(async () => {
  resetFakeDrive();
  $<HTMLFormElement>('#filters').reset(); // filters from a previous test must not leak into this one
  await reloadLibrary();
});

afterEach(() => closeDialogs());

describe('screens', () => {
  it('shows the library, not the access screen, once connected', () => {
    expect($('#library').hidden).toBe(false);
    expect($('#access').hidden).toBe(true);
    expect($('#signout').hidden).toBe(false);
  });

  it('keeps the page title visible on the access screen, like the original', async () => {
    await driveAuth.signOut();

    expect($('#access').hidden).toBe(false);
    expect($('#library').hidden).toBe(true);
    expect($('.intro').hidden).toBe(false);
    expect($('[data-add]').hidden).toBe(true);
    expect($('#signout').hidden).toBe(true);
  });

  it('returns to the access screen after signing out', async () => {
    $<HTMLButtonElement>('#signout').click();

    await vi.waitFor(() => expect($('#access').hidden).toBe(false));
    expect($('#library').hidden).toBe(true);
    expect(text('#list-status')).toBe('Cargando tus estudios…');
  });

  it('connecting from the access screen loads the studies', async () => {
    await driveAuth.signOut();

    $<HTMLButtonElement>('#connect').click();

    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
    expect($('#library').hidden).toBe(false);
  });

  it('shows the access screen when the session is lost while loading', async () => {
    server.use(http.get(FILES, () => new HttpResponse(null, { status: 401 })));

    $<HTMLButtonElement>('#retry').click();

    await vi.waitFor(() => expect($('#access').hidden).toBe(false));
  });

  it('defines every icon the page references (no empty buttons)', () => {
    const defined = new Set([...document.querySelectorAll('symbol')].map((s) => s.id));
    const used = [...document.querySelectorAll('use')].map((u) => u.getAttribute('href')!.slice(1));
    const inRows = [...document.querySelector<HTMLTemplateElement>('#record')!.content.querySelectorAll('use')].map((u) =>
      u.getAttribute('href')!.slice(1)
    );

    expect(used.length).toBeGreaterThan(0);
    expect([...used, ...inRows].filter((id) => !defined.has(id))).toEqual([]);
  });
});

describe('the list', () => {
  it('renders every study, newest first, and counts them', () => {
    expect($('#load-error').hidden).toBe(true);
    expect($('#results').hidden).toBe(false);
    expect(rowIds()).toEqual(['study-2', 'study-1']); // 2024-02-20 before 2024-01-15
    expect(text('#count')).toBe('2');
    expect($('#list-status').hidden).toBe(true);
  });

  it('fills each row from the study', () => {
    const study = row('study-1');

    expect(study.querySelector('.record-title')?.textContent).toBe('Ecografía abdominal');
    expect(study.querySelector('.record-doctor')?.textContent).toBe('Dra. Ana Pérez');
    expect(study.querySelector('.record-portal')?.textContent).toBe('Hospital Central');
    expect(study.querySelector('time')?.textContent).toMatch(/^15 ene\.? 2024$/); // medium es-AR date
    expect(study.querySelector('time')?.getAttribute('datetime')).toBe('2024-01-15');
    expect([...study.querySelectorAll('.type-badge')].map((b) => b.textContent)).toEqual(['Ecografía']);
    expect(study.querySelector('.edit')?.getAttribute('aria-label')).toBe('Editar Ecografía abdominal');
    expect(study.querySelector('.remove')?.getAttribute('aria-label')).toBe('Eliminar Ecografía abdominal');
  });

  it('opens the PDF in Drive in a new tab, safely, and links the viewer', () => {
    const pdf = row('study-1').querySelector<HTMLAnchorElement>('.pdf-link')!;

    expect(pdf.hidden).toBe(false);
    expect(pdf.href).toBe('https://drive.google.com/file/d/study-1/view');
    expect(pdf.target).toBe('_blank');
    expect(pdf.rel).toBe('noopener noreferrer');
    expect(row('study-1').querySelector<HTMLAnchorElement>('.viewer-link')?.href).toBe('https://portal.hospital.com/viewer/123');
  });

  it('marks studies without files', () => {
    expect(row('study-2').querySelector<HTMLElement>('.no-attachment')?.hidden).toBe(false);
    expect(row('study-2').querySelector<HTMLElement>('.pdf-link')?.hidden).toBe(true);
  });

  it('leaves the dot between date, doctor and portal to the CSS (never in the text)', () => {
    const meta = row('study-1').querySelector('.record-meta')!;

    expect(meta.textContent).not.toContain('·');
  });

  it('offers the study types as filter options', () => {
    expect([...$<HTMLSelectElement>('#type').options].map((o) => o.value)).toEqual(['', ...TYPES]);
  });

  it('shows the empty state with its call to action when there are no studies', async () => {
    clearFakeDrive();
    await reloadLibrary();

    await vi.waitFor(() => expect($('#empty').hidden).toBe(false));
    expect($('#results').hidden).toBe(true);
    expect(text('#empty-title')).toBe('Tu archivo empieza acá');
    expect($('#empty-action').dataset.filtered).toBe('false');
    expect($('#empty-action').textContent).toContain('Agregar estudio');
  });

  it('shows a retry when loading fails and the list was never loaded', async () => {
    await driveAuth.signOut();
    server.use(http.get(FILES, () => new HttpResponse(null, { status: 500 })));
    await driveAuth.signIn();

    await vi.waitFor(() => expect($('#load-error').hidden).toBe(false));
    expect(text('#load-error-message')).toContain('no pudo completar');
    expect($('#results').hidden).toBe(true);

    server.resetHandlers();
    server.use(http.get('*/types.json', () => HttpResponse.json(TYPES)));
    $<HTMLButtonElement>('#retry').click();

    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
    expect($('#load-error').hidden).toBe(true);
  });

  it('refreshes when the tab becomes visible again, picking up changes from other devices', async () => {
    addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(rowIds()).toContain('remote-1'));
  });

  it('does not refresh while a dialog is open or the tab is hidden', async () => {
    addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await wait();
    expect(rowIds()).not.toContain('remote-1');

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    $<HTMLButtonElement>('[data-add]').click();
    document.dispatchEvent(new Event('visibilitychange'));
    await wait();
    expect(rowIds()).not.toContain('remote-1');
  });
});

describe('filters', () => {
  const search = (value: string) => typeInto('#search', value);

  it('searches title, doctor and portal ignoring accents and case, and says how many were found', () => {
    search('ECOGRAFIA');

    expect(rowIds()).toEqual(['study-1']);
    expect(text('#list-status')).toBe('1 estudio encontrado');
    expect($('#list-status').hidden).toBe(false);
    expect($('#clear').hidden).toBe(false);
    expect(text('#count')).toBe('2'); // the count is the total, not the matches
  });

  it('filters by type and by date range', () => {
    const type = $<HTMLSelectElement>('#type');
    type.value = 'Ecografía';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rowIds()).toEqual(['study-1']);

    type.value = '';
    typeInto('#from', '2024-02-01');
    expect(rowIds()).toEqual(['study-2']);
    expect(text('#list-status')).toBe('1 estudio encontrado');
  });

  it('explains a reversed date range instead of showing an empty list silently', () => {
    typeInto('#from', '2024-06-01');
    typeInto('#to', '2024-01-01');

    expect(rowIds()).toEqual([]);
    expect(text('#list-status')).toBe('La fecha «Hasta» debe ser igual o posterior a «Desde».');
  });

  it('offers to clear the filters when nothing matches, and clearing restores the list', () => {
    search('nada que coincida');

    expect($('#empty').hidden).toBe(false);
    expect(text('#empty-title')).toBe('No hay estudios con esos filtros');
    expect($('#empty-action').textContent).toBe('Limpiar filtros');
    expect(text('#list-status')).toBe('0 estudios encontrados');

    $<HTMLButtonElement>('#empty-action').click();

    expect($<HTMLInputElement>('#search').value).toBe('');
    expect(rowIds()).toHaveLength(2);
    expect($('#clear').hidden).toBe(true);
    expect($('#list-status').hidden).toBe(true);
  });

  it('the "Limpiar filtros" button resets every filter', () => {
    search('eco');
    typeInto('#from', '2024-01-01');

    $<HTMLButtonElement>('#clear').click();

    expect($<HTMLInputElement>('#search').value).toBe('');
    expect($<HTMLInputElement>('#from').value).toBe('');
    expect(rowIds()).toHaveLength(2);
  });
});

describe('the editor', () => {
  it('opens empty for a new study, focused on the PDF, with the study types as checkboxes', () => {
    $<HTMLButtonElement>('[data-add]').click();

    expect($<HTMLDialogElement>('#editor').open).toBe(true);
    expect(text('#editor-title')).toBe('Agregar estudio');
    expect(field('title').value).toBe('');
    expect([...document.querySelectorAll('#study-types .type-option span')].map((s) => s.textContent)).toEqual(TYPES);
    expect($('#current-report').hidden).toBe(true);
  });

  it('the empty-state button opens it too', async () => {
    clearFakeDrive();
    await reloadLibrary();
    await vi.waitFor(() => expect($('#empty').hidden).toBe(false));

    $<HTMLButtonElement>('#empty-action').click();

    expect($<HTMLDialogElement>('#editor').open).toBe(true);
  });

  it('opens a study filled in, with its types ticked and its current PDF shown', () => {
    edit('study-1');

    expect(text('#editor-title')).toBe('Editar estudio');
    expect(field('title').value).toBe('Ecografía abdominal');
    expect(field('date').value).toBe('2024-01-15');
    expect(field('doctor').value).toBe('Dra. Ana Pérez');
    expect(field('portal').value).toBe('Hospital Central');
    expect(field('viewer').value).toBe('https://portal.hospital.com/viewer/123');
    expect([...document.querySelectorAll<HTMLInputElement>('#study-types input:checked')].map((i) => i.value)).toEqual(['Ecografía']);
    expect($('#current-report').hidden).toBe(false);
    expect(text('#current-report-name')).toBe('Informe.pdf');
  });

  it('suggests every institution already used and fills the field when one is picked', () => {
    const choices = [...document.querySelectorAll<HTMLButtonElement>('#portal-options button')];

    expect($('#portal-choices').hidden).toBe(false);
    expect(choices.map((b) => b.textContent)).toEqual(['Hospital Central', 'LabCorp']);
    $<HTMLButtonElement>('[data-add]').click();
    $<HTMLDetailsElement>('#portal-choices').open = true;

    choices[1]!.click();

    expect(field('portal').value).toBe('LabCorp');
    expect($<HTMLDetailsElement>('#portal-choices').open).toBe(false);
  });

  it('hides the institution list when no study names one', async () => {
    clearFakeDrive();
    await reloadLibrary();

    await vi.waitFor(() => expect($('#portal-choices').hidden).toBe(true));
  });

  it('refuses a save with no type chosen, using the browser validation message', () => {
    edit('study-2');
    const first = document.querySelector<HTMLInputElement>('#study-types input')!;
    for (const input of document.querySelectorAll<HTMLInputElement>('#study-types input')) input.checked = false;
    first.dispatchEvent(new Event('input', { bubbles: true }));

    expect(first.validationMessage).toBe('Elegí al menos un tipo de estudio.');
    expect($<HTMLFormElement>('#editor-form').checkValidity()).toBe(false);

    first.checked = true;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    expect(first.validationMessage).toBe('');
  });

  it('asks for a name when the title is only spaces', async () => {
    edit('study-1');
    field('title').value = '   ';

    submitEditor();

    await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
    expect(text('#form-error')).toBe('Ingresá un nombre para el estudio.');
    expect($<HTMLDialogElement>('#editor').open).toBe(true);
  });

  it('rejects a viewer link that is not http(s)', async () => {
    edit('study-1');
    field('viewer').value = 'ftp://example.com/informe';

    submitEditor();

    await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
    expect(text('#form-error')).toBe('Pegá un enlace al visor que empiece con https:// o http://.');
  });

  it('rejects a report that is not a PDF without saving anything', async () => {
    edit('study-1');
    Object.defineProperty(field('report'), 'files', { configurable: true, value: [new File(['no soy pdf'], 'x.pdf')] });

    submitEditor();

    await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
    expect(text('#form-error')).toBe('Elegí un archivo PDF válido.');
    expect(fakeDriveFile(SEED_PDF_ID)?.version).toBe(1);
  });
});

describe('saving', () => {
  it('saves an edit, closes the editor and shows the new title', async () => {
    edit('study-1');
    field('title').value = 'Ecografía revisada';

    submitEditor();

    await vi.waitFor(() => expect(row('study-1').querySelector('.record-title')?.textContent).toBe('Ecografía revisada'));
    expect($<HTMLDialogElement>('#editor').open).toBe(false);
    expect(fakeDriveFile('study-1')?.version).toBe(2);
    expect(JSON.parse(fakeDriveFile('study-1')!.description).title).toBe('Ecografía revisada');
  });

  it('adds a new study, clears active filters so it is visible, and keeps its institution for later', async () => {
    typeInto('#search', 'ecografía');
    $<HTMLButtonElement>('[data-add]').click();
    field('title').value = 'Radiografía de tórax';
    field('date').value = '2024-04-04';
    const other = document.querySelector<HTMLInputElement>('#study-types input[value="Otro"]')!;
    other.checked = true;
    other.dispatchEvent(new Event('input', { bubbles: true }));
    field('portal').value = 'Clínica Nueva';

    submitEditor();

    await vi.waitFor(() => expect(text('#count')).toBe('3'));
    expect($<HTMLInputElement>('#search').value).toBe('');
    expect(rowIds()).toHaveLength(3);
    expect(rowIds()[0]).not.toBe('study-2'); // the new one (2024-04-04) is the newest
    expect([...document.querySelectorAll('#portal-options button')].map((b) => b.textContent)).toContain('Clínica Nueva');
    expect($<HTMLDialogElement>('#editor').open).toBe(false);
  });

  it('keeps the id reserved for a new study when the first attempt fails, so a retry cannot duplicate it', async () => {
    let failNext = true;
    server.use(
      http.post('https://www.googleapis.com/upload/drive/v3/files', () => {
        if (!failNext) return undefined; // fall through to the fake Drive
        failNext = false;
        return new HttpResponse(null, { status: 500 });
      })
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    $<HTMLButtonElement>('[data-add]').click();
    field('title').value = 'Con reintento';
    field('date').value = '2024-05-05';
    const other = document.querySelector<HTMLInputElement>('#study-types input[value="Otro"]')!;
    other.checked = true;
    other.dispatchEvent(new Event('input', { bubbles: true }));

    submitEditor();
    await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
    submitEditor();
    await vi.waitFor(() => expect(text('#count')).toBe('3'));

    const reservations = fetchSpy.mock.calls.filter(([url]) => String(url).includes('generateIds'));
    expect(reservations).toHaveLength(1);
    expect(rowIds().filter((id) => id?.startsWith('generated-'))).toHaveLength(1);
  });

  it('locks the dialog while saving: no closing, no editing, and a progress label', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.patch(`${FILES}/:id`, async ({ request }) => {
        await gate;
        return HttpResponse.json({ ...(await request.json() as object), id: 'study-1' });
      })
    );
    edit('study-1');
    field('title').value = 'Guardando lento';

    submitEditor();
    await vi.waitFor(() => expect($('#editor').dataset.busy).toBe('true'));

    expect(text('#save')).toBe('Guardando…');
    expect($<HTMLButtonElement>('#save').disabled).toBe(true);
    expect(field('title').disabled).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    $('#editor').dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);

    release();
    await vi.waitFor(() => expect($('#editor').dataset.busy).toBe('false'));
    expect(text('#save')).toBe('Guardar estudio');
    expect($<HTMLButtonElement>('#save').disabled).toBe(false);
  });

  it('lets the user close a dialog that is not busy', () => {
    edit('study-1');
    const cancel = new Event('cancel', { cancelable: true });

    $('#editor').dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(false);
  });

  it('refuses to overwrite a study changed on another device, and refreshes the list behind the dialog', async () => {
    edit('study-1');
    field('title').value = 'Mi versión';
    touchRemote('study-1');

    submitEditor();

    await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
    expect(text('#form-error')).toContain('cambió en Drive');
    expect($('.reconnect', $('#editor')).hidden).toBe(true);
    expect($<HTMLDialogElement>('#editor').open).toBe(true);
    expect(JSON.parse(fakeDriveFile('study-1')!.description).title).toBe('Ecografía abdominal');
  });

  it('offers to reconnect when the session is lost, and saving works after reconnecting', async () => {
    edit('study-1');
    field('title').value = 'Después de reconectar';
    server.use(http.get(`${FILES}/:id`, () => new HttpResponse(null, { status: 401 })));

    submitEditor();

    await vi.waitFor(() => expect($('.reconnect', $('#editor')).hidden).toBe(false));
    expect(text('#form-error')).toBe('Volvé a conectar Google Drive para continuar.');
    expect($('#access').hidden).toBe(true); // the dialog keeps the user's place
    expect($<HTMLDialogElement>('#editor').open).toBe(true);

    server.resetHandlers();
    server.use(http.get('*/types.json', () => HttpResponse.json(TYPES)));
    $<HTMLButtonElement>('.reconnect', $('#editor')).click();
    await vi.waitFor(() => expect($('.reconnect', $('#editor')).hidden).toBe(true));
    await vi.waitFor(() => expect($('#form-error').hidden).toBe(true));
    submitEditor();

    await vi.waitFor(() => expect(row('study-1').querySelector('.record-title')?.textContent).toBe('Después de reconectar'));
  });
});

describe('deleting', () => {
  it('asks for confirmation naming the study, with Cancel focused', () => {
    row('study-1').querySelector<HTMLButtonElement>('.remove')!.click();

    expect($<HTMLDialogElement>('#confirm').open).toBe(true);
    expect(text('#delete-copy')).toBe('«Ecografía abdominal» se moverá a la papelera de Google Drive.');
    expect(document.activeElement).toBe($('.quiet', $('#confirm')));
  });

  it('moves the study to the trash, removes it, and refreshes from Drive afterwards', async () => {
    row('study-1').querySelector<HTMLButtonElement>('.remove')!.click();
    addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');

    $<HTMLFormElement>('#delete-form').requestSubmit();

    await vi.waitFor(() => expect(rowIds()).toContain('remote-1')); // only a fresh list request can show it
    expect(rowIds()).toEqual(['remote-1', 'study-2']);
    expect(fakeDriveFile('study-1')?.trashed).toBe(true);
    expect($<HTMLDialogElement>('#confirm').open).toBe(false);
    expect(text('#count')).toBe('2');
  });

  it('refuses to delete a study changed on another device', async () => {
    row('study-1').querySelector<HTMLButtonElement>('.remove')!.click();
    touchRemote('study-1');

    $<HTMLFormElement>('#delete-form').requestSubmit();

    await vi.waitFor(() => expect($('#delete-error').hidden).toBe(false));
    expect(text('#delete-error')).toContain('cambió en Drive');
    expect(fakeDriveFile('study-1')?.trashed).toBe(false);
    expect($<HTMLDialogElement>('#confirm').open).toBe(true);
  });

  it('offers to reconnect when the session is lost', async () => {
    row('study-1').querySelector<HTMLButtonElement>('.remove')!.click();
    server.use(http.get(`${FILES}/:id`, () => new HttpResponse(null, { status: 401 })));

    $<HTMLFormElement>('#delete-form').requestSubmit();

    await vi.waitFor(() => expect($('.reconnect', $('#confirm')).hidden).toBe(false));
    expect(fakeDriveFile('study-1')?.trashed).toBe(false);
  });
});
