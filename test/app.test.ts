/**
 * Runs the real App against the real index.html. Unit tests of the repositories cannot notice a broken page:
 * these catch wiring mistakes (missing elements, handlers that never match, lists hidden after loading) and hold the
 * behaviour of the original app.js: list, filters, editor, save, delete, conflicts and lost sessions.
 */
import { http, HttpResponse } from 'msw';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { clearFilters } from '@presentation/state/store';
import { addRemoteStudy, clearFakeDrive, fakeDriveFile, resetFakeDrive, SEED_PDF_ID, touchRemote } from './fake-drive';
import { $, closeDialogs, mountPage, reloadLibrary, rowIds, text, TYPES, typeInto } from './page';
import { server } from './server';
import { gis } from './fake-google';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const field = (name: string) => $<HTMLInputElement>(`#editor-form [name="${name}"]`);
const row = (id: string) => $<HTMLLIElement>(`#results li[data-id="${id}"]`);
const edit = (id: string) => act(() => { row(id).querySelector<HTMLButtonElement>('.edit')!.click(); });
const submitEditor = () => $<HTMLFormElement>('#editor-form').requestSubmit();
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(() => mountPage());

beforeEach(async () => {
  resetFakeDrive();
  clearFilters(); // filters from a previous test must not leak into this one
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
    expect(rowIds()).toEqual([]);
  });

  it('connecting from the access screen loads the studies', async () => {
    await driveAuth.signOut();

    $<HTMLButtonElement>('#connect').click();

    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
    expect($('#library').hidden).toBe(false);
  });

  it('shows the access screen when the session is lost while loading', async () => {
    server.use(http.get(FILES, () => new HttpResponse(null, { status: 401 })));

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect($('#access').hidden).toBe(false));
  });

  it('defines every icon the page references (no empty buttons)', () => {
    const defined = new Set([...document.querySelectorAll('symbol')].map((s) => s.id));
    const used = [...document.querySelectorAll('use')].map((u) => u.getAttribute('href')!.slice(1));

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((id) => !defined.has(id))).toEqual([]);
  });
});

describe('the list', () => {
  it('renders every study, newest first, and counts them', () => {
    expect(document.querySelector('#load-error')).toBeNull();
    expect($('#results').hidden).toBe(false);
    expect(rowIds()).toEqual(['study-2', 'study-1']); // 2024-02-20 before 2024-01-15
    expect(text('#count')).toBe('2');
    expect(document.querySelector('#list-status')).toBeNull();
  });

  it('fills each row from the study', () => {
    const study = row('study-1');

    expect(study.querySelector('.record-title')?.textContent).toBe('Ecografía abdominal');
    expect(study.querySelector('.record-doctor')?.textContent).toBe('Dra. Ana Pérez');
    expect(study.querySelector('.record-portal')?.textContent).toBe('Hospital Central');
    expect(study.querySelector('time')?.textContent).toMatch(/^15 (?:de )?ene\.? (?:de )?2024$/); // medium es-AR date
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
    expect(row('study-2').querySelector('.pdf-link')).toBeNull();
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
    expect(document.querySelector('#results')).toBeNull();
    expect(text('#empty h3')).toBe('Tu archivo empieza acá');
    expect($('#empty-action').textContent).toContain('Agregar estudio');
  });

  it('shows a retry when loading fails and the list was never loaded', async () => {
    await driveAuth.signOut();
    server.use(http.get(FILES, () => new HttpResponse(null, { status: 500 })));
    await driveAuth.signIn();

    await vi.waitFor(() => expect(document.querySelector('#load-error')).not.toBeNull());
    expect(text('#load-error-message')).toContain('no pudo completar');
    expect(document.querySelector('#results')).toBeNull();

    server.resetHandlers();
    server.use(http.get('*/types.json', () => HttpResponse.json(TYPES)));
    $<HTMLButtonElement>('#retry').click();

    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
    expect(document.querySelector('#load-error')).toBeNull();
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
    act(() => { $<HTMLButtonElement>('[data-add]').click(); });
    document.dispatchEvent(new Event('visibilitychange'));
    await wait();
    expect(rowIds()).not.toContain('remote-1');
  });
});

describe('filters', () => {
  const search = (value: string) => act(() => typeInto('#search', value));

  it('records a recent search and restores an explicitly saved search', async () => {
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    search('Ecografía');
    act(() => { $<HTMLFormElement>('#filters').requestSubmit(); });
    expect(document.querySelector('#recent-searches')?.textContent).toContain('Ecografía');
    act(() => { $<HTMLButtonElement>('#save-search').click(); });
    search('otra búsqueda');
    act(() => { document.querySelector<HTMLButtonElement>('#saved-searches button[data-search]')!.click(); });
    expect($<HTMLInputElement>('#search').value).toBe('Ecografía');
    act(() => { document.querySelector<HTMLButtonElement>('#saved-searches button[data-remove]')!.click(); });
  });

  it('does not show saved searches from a different Drive account', async () => {
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
    search('consulta privada');
    act(() => { $<HTMLButtonElement>('#save-search').click(); });
    await act(async () => { await driveAuth.signOut(); gis.tokenResponse.access_token = 'other-account-token'; await driveAuth.signIn(); });
    await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('other-account'));
    act(() => { $<HTMLInputElement>('#search').focus(); });
    expect(document.querySelector('#saved-searches')?.textContent).not.toContain('consulta privada');
    localStorage.removeItem('mis-estudios:saved:account-one');
  });

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
    act(() => { type.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(rowIds()).toEqual(['study-1']);

    act(() => { type.value = ''; type.dispatchEvent(new Event('change', { bubbles: true })); typeInto('#from', '2024-02-01'); });
    expect(rowIds()).toEqual(['study-2']);
    expect(text('#list-status')).toBe('1 estudio encontrado');
  });

  it('explains a reversed date range instead of showing an empty list silently', () => {
    act(() => { typeInto('#from', '2024-06-01'); typeInto('#to', '2024-01-01'); });

    expect(rowIds()).toEqual([]);
    expect(text('#empty-no-results h3')).toBe('La fecha «Hasta» debe ser igual o posterior a «Desde».');
  });

  it('offers to clear the filters when nothing matches, and clearing restores the list', () => {
    search('nada que coincida');

    expect(document.querySelector('#empty-no-results')).not.toBeNull();
    expect(text('#empty-no-results h3')).toBe('No hay estudios con esos filtros');
    expect($('#empty-action').textContent).toBe('Limpiar filtros');
    expect(rowIds()).toEqual([]);

    act(() => { $<HTMLButtonElement>('#empty-action').click(); });

    expect($<HTMLInputElement>('#search').value).toBe('');
    expect(rowIds()).toHaveLength(2);
    expect($<HTMLButtonElement>('#clear').disabled).toBe(true);
    expect(document.querySelector('#list-status')).toBeNull();
  });

  it('the "Limpiar filtros" button resets every filter', () => {
    search('eco');
    act(() => typeInto('#from', '2024-01-01'));

    act(() => { $<HTMLButtonElement>('#clear').click(); });

    expect($<HTMLInputElement>('#search').value).toBe('');
    expect($<HTMLInputElement>('#from').value).toBe('');
    expect(rowIds()).toHaveLength(2);
  });
});

describe('the editor', () => {
  it('opens empty for a new study, focused on the PDF, with the study types as checkboxes', () => {
    act(() => { $<HTMLButtonElement>('[data-add]').click(); });

    expect($<HTMLDialogElement>('#editor').open).toBe(true);
    expect(text('#editor-title')).toBe('Agregar estudio');
    expect(field('title').value).toBe('');
    expect([...document.querySelectorAll('#study-types .type-option span')].map((s) => s.textContent)).toEqual(TYPES);
    expect(document.querySelector('#current-report')).toBeNull();
  });

  it('the empty-state button opens it too', async () => {
    clearFakeDrive();
    await reloadLibrary();
    await vi.waitFor(() => expect($('#empty').hidden).toBe(false));

    act(() => { $<HTMLButtonElement>('#empty-action').click(); });

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
    act(() => { $<HTMLButtonElement>('[data-add]').click(); });
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

  it('clears type validation when another study is opened', () => {
    edit('study-2');
    const first = document.querySelector<HTMLInputElement>('#study-types input')!;
    for (const input of document.querySelectorAll<HTMLInputElement>('#study-types input')) input.checked = false;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    expect(first.validationMessage).not.toBe('');
    act(() => { $<HTMLDialogElement>('#editor').close(); });
    edit('study-1');
    expect(first.validationMessage).toBe('');
  });

  it('does not save a preserved draft into a different reconnected account', async () => {
    await driveAuth.getAccountId();
    edit('study-1');
    typeInto('#editor-form [name=title]', 'Borrador privado');
    await act(async () => { await driveAuth.signOut(); });
    gis.tokenResponse.access_token = 'other-account-token';
    await act(async () => { await driveAuth.signIn(); });
    submitEditor();
    await vi.waitFor(() => expect(text('#form-error')).toContain('otra cuenta'));
    expect(fakeDriveFile('study-1')?.description).not.toContain('Borrador privado');
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
    act(() => { $<HTMLButtonElement>('[data-add]').click(); });
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
    act(() => { $<HTMLButtonElement>('[data-add]').click(); });
    act(() => { typeInto('#editor-form [name=title]', 'Con reintento'); typeInto('#editor-form [name=date]', '2024-05-05'); });
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
    expect(field('title').matches(':disabled')).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    $('#editor').dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);

    release();
    await vi.waitFor(() => expect($('#editor').dataset.busy).toBe('false'));
    expect(text('#save')).toBe('Guardar cambios');
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
    act(() => { field('title').value = 'Después de reconectar'; field('title').dispatchEvent(new Event('input', { bubbles: true })); });
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
    act(() => { row('study-1').querySelector<HTMLButtonElement>('.remove')!.click(); });

    expect($<HTMLDialogElement>('#confirm').open).toBe(true);
    expect(text('#delete-copy')).toBe('«Ecografía abdominal» se moverá a la papelera de Google Drive.');
    expect(document.activeElement).toBe($('.quiet', $('#confirm')));
  });

  it('moves the study to the trash, removes it, and refreshes from Drive afterwards', async () => {
    act(() => { row('study-1').querySelector<HTMLButtonElement>('.remove')!.click(); });
    addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');

    $<HTMLFormElement>('#delete-form').requestSubmit();

    await vi.waitFor(() => expect(rowIds()).toContain('remote-1')); // only a fresh list request can show it
    expect(rowIds()).toEqual(['remote-1', 'study-2']);
    expect(fakeDriveFile('study-1')?.trashed).toBe(true);
    expect($<HTMLDialogElement>('#confirm').open).toBe(false);
    expect(text('#count')).toBe('2');
  });

  it('refuses to delete a study changed on another device', async () => {
    act(() => { row('study-1').querySelector<HTMLButtonElement>('.remove')!.click(); });
    touchRemote('study-1');

    $<HTMLFormElement>('#delete-form').requestSubmit();

    await vi.waitFor(() => expect($('#delete-error').hidden).toBe(false));
    expect(text('#delete-error')).toContain('cambió en Drive');
    expect(fakeDriveFile('study-1')?.trashed).toBe(false);
    expect($<HTMLDialogElement>('#confirm').open).toBe(true);
  });

  it('offers to reconnect when the session is lost', async () => {
    act(() => { row('study-1').querySelector<HTMLButtonElement>('.remove')!.click(); });
    server.use(http.get(`${FILES}/:id`, () => new HttpResponse(null, { status: 401 })));

    $<HTMLFormElement>('#delete-form').requestSubmit();

    await vi.waitFor(() => expect($('.reconnect', $('#confirm')).hidden).toBe(false));
    expect(fakeDriveFile('study-1')?.trashed).toBe(false);
  });
});

describe('keyboard shortcuts', () => {
  it('focuses search with / and leaves typing in fields alone', () => {
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })); });
    expect(document.activeElement).toBe($('#search'));
    const input = $<HTMLInputElement>('#search');
    input.focus();
    const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect($<HTMLDialogElement>('#editor').open).toBe(false);
  });

  it('opens the new-study editor with n', () => {
    (document.activeElement as HTMLElement)?.blur();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true })); });
    expect($<HTMLDialogElement>('#editor').open).toBe(true);
  });

  it('clears active filters with Escape outside dialogs', () => {
    typeInto('#search', 'Ecografía');
    (document.activeElement as HTMLElement)?.blur();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect($<HTMLInputElement>('#search').value).toBe('');
  });
});

describe('operations', () => {
  it('creates an operation inside the study editor without losing study fields', async () => {
    act(() => { $<HTMLButtonElement>('[data-add]').click(); });
    typeInto('#editor-title-field', 'Estudio en preparación');
    act(() => { $<HTMLButtonElement>('#create-operation').click(); });
    typeInto('#new-operation-name', 'Cirugía nueva');
    await act(async () => { $<HTMLButtonElement>('#save-new-operation').click(); });
    await vi.waitFor(() => expect($<HTMLSelectElement>('#operation-id').selectedOptions[0]?.textContent).toBe('Cirugía nueva'));
    expect($<HTMLInputElement>('#editor-title-field').value).toBe('Estudio en preparación');
  });

  it('creates an operation and associates a study from the editor', async () => {
    act(() => { $<HTMLButtonElement>('#tab-operaciones').click(); });
    typeInto('#operation-name', 'Cirugía de rodilla');
    await act(async () => { $<HTMLFormElement>('#operation-form').requestSubmit(); });
    await vi.waitFor(() => expect(document.querySelector('#operations-list')?.textContent).toContain('Cirugía de rodilla'));
    act(() => { $<HTMLButtonElement>('#tab-cronologia').click(); });
    await vi.waitFor(() => expect(rowIds()).toContain('study-1'));
    edit('study-1');
    const select = $<HTMLSelectElement>('#operation-id');
    const option = [...select.options].find((item) => item.textContent === 'Cirugía de rodilla')!;
    select.value = option.value;
    act(() => { select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { submitEditor(); });
    await vi.waitFor(() => expect(JSON.parse(fakeDriveFile('study-1')!.description).operationId).toBe(option.value));
  });

  it('links and unlinks an existing study from an operation detail', async () => {
    act(() => { $<HTMLButtonElement>('#tab-operaciones').click(); });
    typeInto('#operation-name', 'Operación con estudios');
    await act(async () => { $<HTMLFormElement>('#operation-form').requestSubmit(); });
    await vi.waitFor(() => expect(document.querySelector('#operations-list')?.textContent).toContain('Operación con estudios'));
    const item = [...document.querySelectorAll<HTMLLIElement>('#operations-list li')].find((li) => li.textContent?.includes('Operación con estudios'))!;
    act(() => { item.querySelector<HTMLButtonElement>('[data-detail]')!.click(); });
    const detail = $('#operation-detail');
    const checkbox = detail.querySelector<HTMLInputElement>('[data-study-id="study-1"]')!;
    await act(async () => { checkbox.click(); });
    await vi.waitFor(() => expect(JSON.parse(fakeDriveFile('study-1')!.description).operationId).toBeTruthy());
    await act(async () => { checkbox.click(); });
    await vi.waitFor(() => expect(JSON.parse(fakeDriveFile('study-1')!.description).operationId).toBe(''));
  });
});

describe('portals', () => {
  it('adds a portal and offers its linked studies', async () => {
    act(() => { $<HTMLButtonElement>('#tab-portales').click(); });
    typeInto('#portal-name', 'Hospital Central');
    typeInto('#portal-url', 'https://hospital.example/');
    await act(async () => { $<HTMLFormElement>('#portal-form').requestSubmit(); });
    await vi.waitFor(() => expect(document.querySelector('#portals-list')?.textContent).toContain('Hospital Central'));
    const link = document.querySelector<HTMLAnchorElement>('#portals-list a')!;
    expect(link.href).toBe('https://hospital.example/');
    act(() => { document.querySelector<HTMLButtonElement>('#portals-list button')!.click(); });
    await vi.waitFor(() => expect(rowIds()).toEqual(['study-1']));
  });
});

describe('category view', () => {
  it('filters studies by selecting a category', async () => {
    addRemoteStudy('study-3', 'Otro informe');
    await reloadLibrary();
    act(() => { $<HTMLButtonElement>('#tab-categoria').click(); });
    const button = [...document.querySelectorAll<HTMLButtonElement>('#categories button')].find((item) => item.textContent === 'Ecografía')!;
    act(() => { button.click(); });
    await vi.waitFor(() => expect(rowIds()).toEqual(['study-1']));
    const other = [...document.querySelectorAll<HTMLButtonElement>('#categories button')].find((item) => item.textContent === 'Otro')!;
    act(() => { other.click(); });
    await vi.waitFor(() => expect(rowIds()).toEqual(['study-3', 'study-1']));
  });
});

describe('sorting', () => {
  it('orders the library by oldest date when selected', async () => {
    act(() => { $<HTMLButtonElement>('#tab-cronologia').click(); });
    const select = $<HTMLSelectElement>('#sort');
    select.value = 'date-asc';
    act(() => { select.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(() => expect(rowIds()).toEqual(['study-1', 'study-2']));
  });
});
