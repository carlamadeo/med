import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth} from '@data';
import {appointments, pendingChanges} from '@presentation/state/store';
import {checkAppointmentReminders} from '@presentation/utils/appointmentReminders';

afterEach(() => {
    appointments.value = [];
    pendingChanges.value = [];
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

it('notifies once and suppresses cancelled appointments', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T12:45:00Z'));
    vi.spyOn(driveAuth, 'cachedAccountId').mockReturnValue('owner');
    vi.spyOn(driveAuth, 'getAccessToken').mockResolvedValue('token');
    const notify = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('Notification', {permission: 'granted'});
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()}
    });
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {controller: {}, ready: Promise.resolve({showNotification: notify})}
    });
    const base = {
        date: '2026-11-20',
        time: '10:30',
        timeZone: 'America/Argentina/Buenos_Aires',
        professional: '',
        notes: '',
        cost: null,
        coverage: null,
        revision: '1',
        reminderMinutes: 60 as const
    };
    appointments.value = [{...base, id: 'one', status: 'scheduled'}, {...base, id: 'two', status: 'cancelled'}];
    await checkAppointmentReminders();
    await checkAppointmentReminders();
    expect(notify).toHaveBeenCalledOnce();
});
