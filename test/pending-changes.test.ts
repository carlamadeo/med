import { h, render } from 'preact';
import { afterEach, expect, it } from 'vitest';
import { PendingChangesSection } from '@presentation/components/PendingChangesSection';
import { pendingChanges, syncMessage, syncing, studies, appointments } from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => { render(null, root); pendingChanges.value = []; syncMessage.value = ''; syncing.value = false; studies.value = []; appointments.value = []; });

it('compares both versions of an appointment before retrying', () => {
  const base = { date: '2026-11-20', time: '10:30', timeZone: 'America/Argentina/Buenos_Aires', professional: 'Dra. Local', notes: '', status: 'scheduled' as const, cost: null, coverage: null };
  appointments.value = [{ ...base, id: 'one', revision: '2', professional: 'Dr. Remoto' }];
  pendingChanges.value = [{ id: 1, owner: 'account-one', kind: 'appointment-save', status: 'conflict', appointmentId: 'one', appointmentDraft: { ...base, id: 'one', revision: '1' } }];
  render(h(PendingChangesSection, { onDiscard: () => {}, onRetrySync: () => {}, onResolveConflict: () => {} }), root);
  expect(root.textContent).toContain('Dra. Local');
  expect(root.textContent).toContain('Dr. Remoto');
  expect(root.textContent).toContain('Conservar mi cambio');
});

it('announces that synchronization is in progress while keeping the change pending', () => {
  pendingChanges.value = [{ id: 1, owner: 'account-one', kind: 'save', status: 'pending', draft: { title: 'Informe', date: '', types: [], doctor: '', portal: '', viewer: '', reportName: '' } }];
  syncing.value = true;
  render(h(PendingChangesSection, { onDiscard: () => {}, onRetrySync: () => {}, onResolveConflict: () => {} }), root);
  expect(root.querySelector('[role="status"]')?.textContent).toContain('Sincronizando');
  expect(root.textContent).toContain('Informe');
});

it('shows the local and remote versions of a conflicting study', () => {
  studies.value = [{ id: 'one', title: 'Versión de Drive', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveFileId: 'one', driveModifiedTime: '', revision: '2' }];
  pendingChanges.value = [{ id: 1, owner: 'account-one', kind: 'save', status: 'conflict', studyId: 'one', draft: { title: 'Mi versión', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', driveFileId: 'one', revision: '1' } }];
  render(h(PendingChangesSection, { onDiscard: () => {}, onRetrySync: () => {}, onResolveConflict: () => {} }), root);
  expect(root.textContent).toContain('Mi versión');
  expect(root.textContent).toContain('Versión de Drive');
  expect(root.textContent).toContain('Conservar mi cambio');
});
