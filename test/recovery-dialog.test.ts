import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { RecoveryDialog } from '@presentation/components/RecoveryDialog';
import { setRecoveringStudyId } from '@presentation/state/store';
import { driveAuth, driveStudyRepo, driveEpisodeRepo, driveOperationRepo, drivePortalRepo, driveMedicalEventRepo, driveAppointmentRepo } from '@data';

const root = document.createElement('div');
afterEach(() => { render(null, root); root.remove(); setRecoveringStudyId(null); vi.restoreAllMocks(); });

it('reports a failure to load deleted studies instead of showing an empty result', async () => {
  vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
  vi.spyOn(driveStudyRepo, 'listDeleted').mockRejectedValue(new Error('Sin conexión'));
  vi.spyOn(driveEpisodeRepo, 'listDeleted').mockResolvedValue([]);
  vi.spyOn(driveOperationRepo, 'listDeleted').mockResolvedValue([]);
  vi.spyOn(drivePortalRepo, 'listDeleted').mockResolvedValue([]);
  vi.spyOn(driveMedicalEventRepo, 'listDeleted').mockResolvedValue([]);
  vi.spyOn(driveAppointmentRepo, 'listDeleted').mockResolvedValue([]);
  document.body.append(root);
  await act(() => { render(h(RecoveryDialog, { onReconnect: () => {}, error: null, sessionLost: false }), root); setRecoveringStudyId('recovery'); });
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('Sin conexión'));
  expect(root.textContent).not.toContain('No hay estudios recuperables');
});
