import { afterEach, describe, expect, it, vi } from 'vitest';
import { Outbox, type OutboxAdapter } from '@data/outbox';
import { DriveConflictError } from '@data';
import { storage } from '@core/storage';

const owner = 'account-one';
const draft = { title: 'Informe', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '' };
const adapter = (account = owner): OutboxAdapter => ({
  accountId: vi.fn(async () => account),
  reserveId: vi.fn(async () => 'reserved-1'),
  save: vi.fn(async () => {}),
  restore: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
  saveOperation: vi.fn(async () => {}),
  deleteOperation: vi.fn(async () => {}),
  restoreOperation: vi.fn(async () => {}),
  savePortal: vi.fn(async () => {}),
  deletePortal: vi.fn(async () => {}),
  restorePortal: vi.fn(async () => {}),
  saveEvent: vi.fn(async () => {}),
  deleteEvent: vi.fn(async () => {}),
  restoreEvent: vi.fn(async () => {}),
  saveEpisode: vi.fn(async () => {}),
  deleteEpisode: vi.fn(async () => {}),
  restoreEpisode: vi.fn(async () => {}),
  saveAppointment: vi.fn(async () => {}),
  deleteAppointment: vi.fn(async () => {}),
  restoreAppointment: vi.fn(async () => {}),
  lock: async (_name, callback) => callback(),
});
const queue = new Outbox();
afterEach(async () => { for (const entry of await queue.list(owner)) await queue.discard(owner, entry.id!); });

describe('offline outbox', () => {
  it('rejects an event linking a document already pending deletion', async () => {
    await queue.enqueueDelete(owner, 'document-1', '1');
    await expect(queue.enqueueEventSave(owner, {
      kind: 'consultation', date: '2024-01-01', doctor: '', notes: '',
      studyIds: [], documentIds: ['document-1'],
    })).rejects.toThrow('documento vinculado');
    expect(await queue.list(owner)).toHaveLength(1);
  });
  it('retries a conflicting appointment using the reviewed revision', async () => {
    const draft = { id: 'turno-1', revision: '1', date: '2026-11-20', time: '10:30', timeZone: 'America/Argentina/Buenos_Aires', professional: 'Dra. Paz', notes: '', status: 'scheduled' as const, cost: null, coverage: null };
    await queue.enqueueAppointmentSave(owner, draft);
    const remote = adapter();
    vi.mocked(remote.saveAppointment).mockRejectedValueOnce(new DriveConflictError());
    await queue.sync(owner, remote);
    const conflict = (await queue.list(owner))[0]!;
    expect(conflict.status).toBe('conflict');
    await queue.retryConflict(owner, conflict.id!, '2');
    await queue.sync(owner, remote);
    expect(remote.saveAppointment).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'turno-1', revision: '2', professional: 'Dra. Paz' }));
    expect(await queue.list(owner)).toEqual([]);
  });
  it('preserves a queued restoration for its owner and retries failures', async () => {
    await queue.enqueueRestore(owner, 'study-1', '2');
    const remote = adapter();
    vi.mocked(remote.restore).mockRejectedValueOnce(new Error('sin conexión'));
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]).toMatchObject({ kind: 'restore', studyId: 'study-1', revision: '2', status: 'pending' });
    await queue.sync(owner, remote);
    expect(remote.restore).toHaveBeenLastCalledWith('study-1', '2');
    expect(await queue.list(owner)).toEqual([]);
  });
  it('stores pending work by account without letting another account read or sync it', async () => {
    await queue.enqueueSave(owner, draft);
    expect(await queue.list('other-account')).toEqual([]);
    const other = adapter('other-account');
    await queue.sync(owner, other);
    expect(other.save).not.toHaveBeenCalled();
    expect(await queue.list(owner)).toHaveLength(1);
  });

  it('retains pending work when the ordinary study cache is cleared', async () => {
    await queue.enqueueSave(owner, draft);
    await storage.clearStudyCache();
    expect(await queue.list(owner)).toHaveLength(1);
  });

  it('reserves and persists a Drive ID before a create, then removes only a successful entry', async () => {
    await queue.enqueueSave(owner, draft);
    const remote = adapter();
    vi.mocked(remote.save).mockRejectedValueOnce(new Error('sin conexión'));
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]?.draft?.id).toBe('reserved-1');
    await queue.sync(owner, remote);
    expect(remote.reserveId).toHaveBeenCalledTimes(1);
    expect(remote.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'reserved-1' }));
    expect(await queue.list(owner)).toEqual([]);
  });

  it('serializes two sync requests for the same owner under the shared lock', async () => {
    await queue.enqueueSave(owner, draft);
    let releaseSave!: () => void;
    let saveStarted!: () => void;
    const saving = new Promise<void>((resolve) => { releaseSave = resolve; });
    const started = new Promise<void>((resolve) => { saveStarted = resolve; });
    let tail = Promise.resolve();
    const remote = adapter();
    remote.lock = async (_name, callback) => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await prior;
      try { await callback(); } finally { release(); }
    };
    vi.mocked(remote.save).mockImplementation(async () => { saveStarted(); await saving; });
    const first = queue.sync(owner, remote);
    await started;
    const second = queue.sync(owner, remote);
    expect(await queue.list(owner)).toHaveLength(1);
    expect(remote.save).toHaveBeenCalledTimes(1);
    releaseSave();
    await Promise.all([first, second]);
    expect(remote.save).toHaveBeenCalledTimes(1);
    expect(await queue.list(owner)).toEqual([]);
  });

  it('stops at a conflict without discarding it or sending later work', async () => {
    await queue.enqueueSave(owner, { ...draft, driveFileId: 'one', revision: '1' });
    await queue.enqueueSave(owner, { ...draft, driveFileId: 'two', revision: '1' });
    const remote = adapter();
    vi.mocked(remote.save).mockRejectedValueOnce(new DriveConflictError());
    await queue.sync(owner, remote);
    const pending = await queue.list(owner);
    expect(pending).toHaveLength(2);
    expect(pending[0]?.status).toBe('conflict');
    expect(remote.save).toHaveBeenCalledTimes(1);
    await queue.sync(owner, remote);
    expect(remote.save).toHaveBeenCalledTimes(1);
  });

  it('marks malformed work as failed and stops automatic retries', async () => {
    const { openDB } = await import('idb');
    const db = await openDB('mis-estudios-outbox', 1);
    await db.add('entries', { owner, kind: 'save', status: 'pending' });
    const remote = adapter();
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]).toMatchObject({ status: 'failed', lastError: 'Cambio pendiente inválido.' });
    await queue.sync(owner, remote);
    expect(remote.save).not.toHaveBeenCalled();
    expect((await queue.list(owner))[0]?.status).toBe('failed');
    db.close();
  });

  it('replaces a conflicting study change with a new pending mutation at the reviewed revision', async () => {
    await queue.enqueueSave(owner, { ...draft, driveFileId: 'one', revision: '1' });
    const remote = adapter();
    vi.mocked(remote.save).mockRejectedValueOnce(new DriveConflictError());
    await queue.sync(owner, remote);
    const old = (await queue.list(owner))[0]!;
    await queue.retryConflict(owner, old.id!, '2');
    const replacement = (await queue.list(owner))[0]!;
    expect(replacement.id).not.toBe(old.id);
    expect(replacement).toMatchObject({ status: 'pending', draft: { title: 'Informe', revision: '2', driveFileId: 'one' } });
    await queue.sync(owner, remote);
    expect(remote.save).toHaveBeenLastCalledWith(expect.objectContaining({ revision: '2' }));
    expect(await queue.list(owner)).toEqual([]);
  });

  it('reserves and retries a medical event without changing its identity', async () => {
    await queue.enqueueEventSave(owner, { kind: 'prescription', date: '2024-01-01', doctor: '', notes: 'Nota', studyIds: ['study-1'], documentIds: [] });
    const remote = adapter();
    vi.mocked(remote.saveEvent).mockRejectedValueOnce(new Error('sin conexión'));
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]?.eventDraft?.createId).toBe('reserved-1');
    await queue.sync(owner, remote);
    expect(remote.reserveId).toHaveBeenCalledTimes(1);
    expect(remote.saveEvent).toHaveBeenLastCalledWith(expect.objectContaining({ createId: 'reserved-1' }));
    expect(await queue.list(owner)).toEqual([]);
  });

  it('rejects a second pending change to the same study', async () => {
    await queue.enqueueSave(owner, { ...draft, driveFileId: 'one', revision: '1' });
    await expect(queue.enqueueDelete(owner, 'one', '1')).rejects.toThrow('pendiente');
  });

  it('serializes concurrent requests for the same study', async () => {
    const results = await Promise.allSettled([
      queue.enqueueSave(owner, { ...draft, driveFileId: 'one', revision: '1' }),
      queue.enqueueDelete(owner, 'one', '1'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await queue.list(owner))).toHaveLength(1);
  });

  it('preserves the attached PDF while waiting for synchronization', async () => {
    const pdf = new File(['%PDF-archivo'], 'informe.pdf', { type: 'application/pdf' });
    await queue.enqueueSave(owner, { ...draft, file: pdf });
    const remote = adapter();
    await queue.sync(owner, remote);
    const saved = vi.mocked(remote.save).mock.calls[0]?.[0];
    expect(saved?.file?.name).toBe('informe.pdf');
    expect(await saved?.file?.text()).toBe('%PDF-archivo');
  });

  it('preserves an attachment MIME type and bytes across an offline retry', async () => {
    const image = new File([new Uint8Array([255, 216, 255, 224])], 'estudio.jpg', { type: 'image/jpeg' });
    await queue.enqueueSave(owner, { ...draft, file: image });
    const remote = adapter();
    vi.mocked(remote.save).mockRejectedValueOnce(new Error('sin red'));
    await queue.sync(owner, remote);
    await queue.sync(owner, remote);
    const saved = vi.mocked(remote.save).mock.calls[1]?.[0].file;
    expect(saved?.name).toBe('estudio.jpg');
    expect(saved?.type).toBe('image/jpeg');
    expect([...new Uint8Array(await saved!.arrayBuffer())]).toEqual([255, 216, 255, 224]);
  });

  it('keeps legacy queued PDF attachments readable when MIME metadata is absent', async () => {
    const { openDB } = await import('idb');
    const db = await openDB('mis-estudios-outbox', 1);
    await db.add('entries', { owner, kind: 'save', status: 'pending', draft, attachment: new Blob(['%PDF-legacy']), attachmentName: 'legacy.pdf' });
    db.close();
    const remote = adapter();
    await queue.sync(owner, remote);
    expect(vi.mocked(remote.save).mock.calls[0]?.[0].file?.type).toBe('application/pdf');
  });

  it('keeps a queued deletion when its Drive revision conflicts', async () => {
    await queue.enqueueDelete(owner, 'one', '1');
    const remote = adapter();
    vi.mocked(remote.delete).mockRejectedValueOnce(new DriveConflictError());
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]).toMatchObject({ kind: 'delete', studyId: 'one', status: 'conflict' });
  });

  it('reserves stable IDs for offline operations and portals before sending them', async () => {
    await queue.enqueueOperationSave(owner, { name: 'Intervención' });
    await queue.enqueuePortalSave(owner, { name: 'clinica', displayName: 'Clínica', url: 'https://example.com' });
    const remote = adapter();
    vi.mocked(remote.reserveId).mockResolvedValueOnce('operation-id').mockResolvedValueOnce('portal-id');
    vi.mocked(remote.saveOperation).mockRejectedValueOnce(new Error('sin red'));
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]?.operationDraft?.createId).toBe('operation-id');
    await queue.sync(owner, remote);
    expect(remote.saveOperation).toHaveBeenLastCalledWith(expect.objectContaining({ createId: 'operation-id' }));
    expect(remote.savePortal).toHaveBeenCalledWith(expect.objectContaining({ createId: 'portal-id' }));
    expect(await queue.list(owner)).toEqual([]);
  });

  it('does not remove a PDF while another pending study links it', async () => {
    await queue.enqueueSave(owner, { ...draft, driveFileId: 'target', revision: '1', documentIds: ['source'] });
    await expect(queue.enqueueDelete(owner, 'source', '1')).rejects.toThrow('vínculo pendiente');
    expect(await queue.list(owner)).toHaveLength(1);
  });

  it('does not queue a link to an operation that is pending deletion', async () => {
    await queue.enqueueOperationDelete(owner, 'op-one', '1');
    await expect(queue.enqueueSave(owner, { ...draft, operationId: 'op-one' })).rejects.toThrow('eliminación pendiente');
  });

  it('does not queue operation deletion while a pending study links to it', async () => {
    await queue.enqueueSave(owner, { ...draft, operationId: 'op-one' });
    await expect(queue.enqueueOperationDelete(owner, 'op-one', '1')).rejects.toThrow('estudio pendiente');
  });

  it('keeps a conflicting portal edit and prevents a second pending change to it', async () => {
    const portal = { id: 'portal-one', revision: '1', name: 'clinica', displayName: 'Clínica', url: 'https://example.com' };
    await queue.enqueuePortalSave(owner, portal);
    await expect(queue.enqueuePortalDelete(owner, portal)).rejects.toThrow('pendiente');
    const remote = adapter();
    vi.mocked(remote.savePortal).mockRejectedValueOnce(new DriveConflictError());
    await queue.sync(owner, remote);
    expect((await queue.list(owner))[0]).toMatchObject({ kind: 'portal-save', status: 'conflict', portalId: 'portal-one' });
  });
});

describe('directory changes in the offline queue', () => {
  it.each([
    ['operation-delete', (q: Outbox) => q.enqueueOperationDelete(owner, 'id', '2'), 'deleteOperation'],
    ['portal-delete', (q: Outbox) => q.enqueuePortalDelete(owner, { id: 'id', revision: '2', name: 'p', displayName: 'P', url: '' }), 'deletePortal'],
    ['event-delete', (q: Outbox) => q.enqueueEventDelete(owner, 'id', '2'), 'deleteEvent'],
    ['episode-delete', (q: Outbox) => q.enqueueEpisodeDelete(owner, 'id', '2'), 'deleteEpisode'],
    ['appointment-delete', (q: Outbox) => q.enqueueAppointmentDelete(owner, 'id', '2'), 'deleteAppointment'],
    ['operation-restore', (q: Outbox) => q.enqueueOperationRestore(owner, 'id', '2'), 'restoreOperation'],
    ['portal-restore', (q: Outbox) => q.enqueuePortalRestore(owner, 'id', '2'), 'restorePortal'],
    ['event-restore', (q: Outbox) => q.enqueueEventRestore(owner, 'id', '2'), 'restoreEvent'],
    ['episode-restore', (q: Outbox) => q.enqueueEpisodeRestore(owner, 'id', '2'), 'restoreEpisode'],
    ['appointment-restore', (q: Outbox) => q.enqueueAppointmentRestore(owner, 'id', '2'), 'restoreAppointment'],
  ] as const)('sends %s and removes it after confirmation', async (_kind, enqueue, method) => {
    await enqueue(queue);
    const remote = adapter();
    await queue.sync(owner, remote);
    expect(remote[method]).toHaveBeenCalledOnce();
    expect(await queue.list(owner)).toEqual([]);
  });

  it('reserves stable IDs for episodes and appointments', async () => {
    await queue.enqueueEpisodeSave(owner, { illness: 'Episodio' });
    await queue.enqueueAppointmentSave(owner, {
      date: '2026-11-20', time: '10:30', timeZone: 'America/Argentina/Buenos_Aires',
      professional: '', notes: '', status: 'scheduled', cost: null, coverage: null,
    });
    const remote = adapter();
    await queue.sync(owner, remote);
    expect(remote.saveEpisode).toHaveBeenCalledWith(expect.objectContaining({ createId: 'reserved-1' }));
    expect(remote.saveAppointment).toHaveBeenCalledWith(expect.objectContaining({ createId: 'reserved-1' }));
    expect(await queue.list(owner)).toEqual([]);
  });
});
