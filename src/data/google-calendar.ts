import {buildGoogleCalendarEvent, googleCalendarEventId} from '@domain/appointments';
import type {Appointment} from '@domain/models';
import {DriveError, DriveSessionError, type DriveClient} from './drive-api';

const CALENDAR_ROOT = 'https://www.googleapis.com/calendar/v3/';
const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3/';
const CALENDAR_CONFIG_MARKER = 'calendario-v1';
const CALENDAR_NAME = 'Turnos';
const CALENDAR_DESCRIPTION = 'Turnos médicos sincronizados desde Mis estudios.';
const CONFIG_FIELDS = 'id,description,version,mimeType,trashed,appProperties';

interface StoredCalendarConfig {
    fileId: string;
    calendarId?: string;
}

/** Synchronizes scheduled medical appointments with a dedicated "Turnos" secondary Google Calendar. */
export class GoogleCalendarRepository {
    private cachedCalendar: {token: string; id: string} | null = null;
    private calendarLookup: {token: string; promise: Promise<string>} | null = null;

    constructor(private client: DriveClient) {
        this.client.onAuthChange((signedIn) => {
            if (!signedIn) {
                this.cachedCalendar = null;
                this.calendarLookup = null;
            }
        });
    }

    private async findStoredConfig(token: string): Promise<StoredCalendarConfig | null> {
        const files = await this.client.listFiles(CALENDAR_CONFIG_MARKER, CONFIG_FIELDS, token);
        let fallbackFileId: string | null = null;
        for (const file of files) {
            if (file.trashed || file.appProperties?.misEstudios !== CALENDAR_CONFIG_MARKER) continue;
            if (!fallbackFileId) fallbackFileId = file.id;
            try {
                const parsed = JSON.parse(file.description) as {calendarId?: unknown};
                if (typeof parsed.calendarId === 'string' && parsed.calendarId.trim()) {
                    return {fileId: file.id, calendarId: parsed.calendarId.trim()};
                }
            } catch {
                // Keep scanning or reuse this file when recreating config.
            }
        }
        return fallbackFileId ? {fileId: fallbackFileId} : null;
    }

    private async verifyCalendar(calendarId: string, token: string): Promise<boolean> {
        try {
            const calendar = await this.client
                .request(`${CALENDAR_ROOT}calendars/${encodeURIComponent(calendarId)}`, {}, token)
                .then((response) => response.json() as Promise<{id?: string; deleted?: boolean}>);
            await this.client.assertSession(token);
            return calendar.deleted !== true;
        } catch (error) {
            if (error instanceof DriveError && (error.status === 404 || error.status === 410)) {
                return false;
            }
            throw error;
        }
    }

    private async findCalendarId(token: string): Promise<string | null> {
        if (this.cachedCalendar?.token === token) return this.cachedCalendar.id;
        const stored = await this.findStoredConfig(token);
        if (!stored?.calendarId) return null;
        const exists = await this.verifyCalendar(stored.calendarId, token);
        if (!exists) return null;
        this.cachedCalendar = {token, id: stored.calendarId};
        return stored.calendarId;
    }

    private async resolveOrCreateCalendarId(token: string): Promise<string> {
        const stored = await this.findStoredConfig(token);
        if (stored?.calendarId && await this.verifyCalendar(stored.calendarId, token)) {
            await this.client.assertSession(token);
            this.cachedCalendar = {token, id: stored.calendarId};
            return stored.calendarId;
        }

        const timeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires';
        const created = await this.client
            .request(
                `${CALENDAR_ROOT}calendars`,
                this.client.jsonBody('POST', {
                    summary: CALENDAR_NAME,
                    description: CALENDAR_DESCRIPTION,
                    timeZone,
                }),
                token,
            )
            .then((response) => response.json() as Promise<{id?: string}>);
        await this.client.assertSession(token);
        if (!created.id) {
            throw new Error('Google Calendar no devolvió un identificador para el calendario.');
        }

        const description = JSON.stringify({calendarId: created.id});
        if (stored?.fileId) {
            await this.client.request(
                this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(stored.fileId)}`, {fields: 'id'}),
                this.client.jsonBody('PATCH', {description}),
                token,
            );
        } else {
            const id = await this.client.reserveId(token);
            const folder = await this.client.getFolderId(token);
            await this.client.assertSession(token);
            await this.client.upload(
                'files',
                'POST',
                {
                    id,
                    name: 'Calendario Turnos.json',
                    description,
                    mimeType: 'application/json',
                    parents: [folder],
                    appProperties: {misEstudios: CALENDAR_CONFIG_MARKER},
                },
                new Blob([description], {type: 'application/json'}),
                'application/json',
                undefined,
                token,
            );
        }
        await this.client.assertSession(token);
        this.cachedCalendar = {token, id: created.id};
        return created.id;
    }

    async getOrCreateCalendarId(expectedToken?: string): Promise<string> {
        const token = await this.client.getAccessToken();
        if (expectedToken !== undefined && token !== expectedToken) throw new DriveSessionError();
        if (!this.client.hasCalendarAccess) {
            throw new Error('La cuenta actual no autorizó el acceso a Google Calendar.');
        }
        if (this.cachedCalendar?.token === token) return this.cachedCalendar.id;
        if (this.calendarLookup?.token === token) return this.calendarLookup.promise;

        const promise = this.resolveOrCreateCalendarId(token);
        this.calendarLookup = {token, promise};
        try {
            return await promise;
        } finally {
            if (this.calendarLookup?.promise === promise) this.calendarLookup = null;
        }
    }

    async syncAppointment(
        appointment: Appointment,
        expectedToken?: string,
        options?: {preferUpdate?: boolean},
    ): Promise<'synced' | 'removed' | 'skipped'> {
        if (!this.client.hasCalendarAccess) return 'skipped';
        if (appointment.status === 'cancelled' || appointment.status === 'absent') {
            return this.removeAppointment(appointment.id, expectedToken);
        }
        if (appointment.status !== 'scheduled') return 'skipped';

        const token = expectedToken ?? await this.client.getAccessToken();
        if (expectedToken !== undefined && token !== expectedToken) throw new DriveSessionError();
        const calendarId = await this.getOrCreateCalendarId(token);
        const eventId = await googleCalendarEventId(appointment.id);
        const payload = buildGoogleCalendarEvent(appointment, eventId);
        const insertUrl = `${CALENDAR_ROOT}calendars/${encodeURIComponent(calendarId)}/events`;
        const eventUrl = `${insertUrl}/${encodeURIComponent(eventId)}`;

        if (options?.preferUpdate) {
            try {
                await this.client.request(eventUrl, this.client.jsonBody('PUT', payload), token);
            } catch (error) {
                if (!(error instanceof DriveError) || error.status !== 404) throw error;
                await this.client.request(insertUrl, this.client.jsonBody('POST', payload), token);
            }
        } else {
            try {
                await this.client.request(insertUrl, this.client.jsonBody('POST', payload), token);
            } catch (error) {
                if (!(error instanceof DriveError) || error.status !== 409) throw error;
                await this.client.request(eventUrl, this.client.jsonBody('PUT', payload), token);
            }
        }
        await this.client.assertSession(token);
        return 'synced';
    }

    async removeAppointment(appointmentId: string, expectedToken?: string): Promise<'removed' | 'skipped'> {
        if (!this.client.hasCalendarAccess) return 'skipped';
        const token = expectedToken ?? await this.client.getAccessToken();
        if (expectedToken !== undefined && token !== expectedToken) throw new DriveSessionError();
        const calendarId = await this.findCalendarId(token);
        if (!calendarId) return 'skipped';
        const eventId = await googleCalendarEventId(appointmentId);
        const eventUrl = `${CALENDAR_ROOT}calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

        try {
            await this.client.request(eventUrl, {method: 'DELETE'}, token);
        } catch (error) {
            if (!(error instanceof DriveError) || (error.status !== 404 && error.status !== 410)) {
                throw error;
            }
        }
        await this.client.assertSession(token);
        return 'removed';
    }
}
