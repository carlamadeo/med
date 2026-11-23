import {http, HttpResponse} from 'msw';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;

export interface FakeCalendar {
    id: string;
    summary: string;
    description: string;
    timeZone: string;
    deleted: boolean;
}

export interface FakeCalendarEvent {
    id: string;
    status: 'confirmed' | 'cancelled';
    summary: string;
    location: string;
    description: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    reminders: {
        useDefault: boolean;
        overrides?: Array<{ method: string; minutes: number }>;
    };
}

const calendars = new Map<string, FakeCalendar>();
const eventsByCalendar = new Map<string, Map<string, FakeCalendarEvent>>();
let calendarCounter = 0;

export function resetFakeCalendar(): void {
    calendars.clear();
    eventsByCalendar.clear();
    calendarCounter = 0;
}

export function fakeCalendars(): FakeCalendar[] {
    return [...calendars.values()];
}

export function fakeCalendarEvents(calendarId: string): FakeCalendarEvent[] {
    return [...(eventsByCalendar.get(calendarId)?.values() ?? [])];
}

export function deleteFakeCalendar(calendarId: string): void {
    calendars.delete(calendarId);
}

function validateOverrides(body: Partial<FakeCalendarEvent>): boolean {
    const overrides = body.reminders?.overrides;
    if (!overrides) return true;
    return overrides.every(
        (item) => Number.isInteger(item.minutes) && item.minutes >= 0 && item.minutes <= 40_320,
    );
}

export const calendarHandlers = [
    http.post(`${CALENDAR_API}/calendars`, async ({request}) => {
        const body = (await request.json()) as Partial<FakeCalendar>;
        const id = `cal-${++calendarCounter}`;
        const calendar: FakeCalendar = {
            id,
            summary: body.summary ?? '',
            description: body.description ?? '',
            timeZone: body.timeZone ?? 'UTC',
            deleted: false,
        };
        calendars.set(id, calendar);
        eventsByCalendar.set(id, new Map());
        return HttpResponse.json(calendar);
    }),

    http.get(`${CALENDAR_API}/calendars/:calendarId`, ({params}) => {
        const calendar = calendars.get(String(params.calendarId));
        if (!calendar || calendar.deleted) return new HttpResponse(null, {status: 404});
        return HttpResponse.json(calendar);
    }),

    http.post(`${CALENDAR_API}/calendars/:calendarId/events`, async ({params, request}) => {
        const calendar = calendars.get(String(params.calendarId));
        if (!calendar || calendar.deleted) return new HttpResponse(null, {status: 404});
        const body = (await request.json()) as FakeCalendarEvent;
        if (typeof body.id !== 'string' || !EVENT_ID_PATTERN.test(body.id) || !validateOverrides(body)) {
            return new HttpResponse(null, {status: 400});
        }
        const events = eventsByCalendar.get(calendar.id)!;
        if (events.has(body.id)) return new HttpResponse(null, {status: 409});
        const stored: FakeCalendarEvent = {...body, status: body.status ?? 'confirmed'};
        events.set(stored.id, stored);
        return HttpResponse.json(stored);
    }),

    http.put(`${CALENDAR_API}/calendars/:calendarId/events/:eventId`, async ({params, request}) => {
        const calendar = calendars.get(String(params.calendarId));
        if (!calendar || calendar.deleted) return new HttpResponse(null, {status: 404});
        const eventId = String(params.eventId);
        if (!EVENT_ID_PATTERN.test(eventId)) return new HttpResponse(null, {status: 400});
        const events = eventsByCalendar.get(calendar.id)!;
        if (!events.has(eventId)) return new HttpResponse(null, {status: 404});
        const body = (await request.json()) as FakeCalendarEvent;
        if (!validateOverrides(body)) return new HttpResponse(null, {status: 400});
        const updated: FakeCalendarEvent = {...body, id: eventId, status: body.status ?? 'confirmed'};
        events.set(eventId, updated);
        return HttpResponse.json(updated);
    }),

    http.delete(`${CALENDAR_API}/calendars/:calendarId/events/:eventId`, ({params}) => {
        const calendar = calendars.get(String(params.calendarId));
        if (!calendar || calendar.deleted) return new HttpResponse(null, {status: 404});
        const eventId = String(params.eventId);
        const events = eventsByCalendar.get(calendar.id)!;
        const existing = events.get(eventId);
        if (!existing) return new HttpResponse(null, {status: 404});
        if (existing.status === 'cancelled') return new HttpResponse(null, {status: 410});
        existing.status = 'cancelled';
        return new HttpResponse(null, {status: 204});
    }),
];
