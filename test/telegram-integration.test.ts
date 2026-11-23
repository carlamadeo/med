// @vitest-environment node
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {http, HttpResponse} from 'msw';
import {expect, it} from 'vitest';
import {googleServices} from '../src/bot/google';
import {readReport} from '../src/bot/pdf';
import {writeJson} from '../src/bot/private-state';
import {incoming, privateUpdate} from '../src/bot/telegram';
import {pdf} from './e2e/pdf-fixture';
import {fakeCalendars, fakeCalendarEvents} from './fake-calendar';
import {fakeDriveFile, FOLDER_ID} from './fake-drive';
import {server} from './server';

const lines = 'BT /F1 16 Tf 50 750 Td (Estudio: Ecografia) Tj 0 -30 Td (Fecha: 18/03/24) Tj 0 -30 Td (Medico: Dra. Ana Perez) Tj ET';
const report = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`,
]);
const document = () => new File([Buffer.from(report, 'base64')], 'Informe.pdf', {type: 'application/pdf'});

it('lee un informe PDF sintético usando el lector de Telegram', async () => {
    await expect(readReport(document())).resolves.toEqual({
        date: '2024-03-18', types: ['Ecografía'], doctor: 'Ana Perez',
    });
});

it('toma el enlace embebido del mensaje y solo admite el chat personal autorizado', () => {
    const update = {
        update_id: 1, message: {
            chat: {id: 44, type: 'private'}, from: {id: 44},
            caption: 'Abrir informe', caption_entities: [{type: 'text_link', url: 'https://portal.example/visor'}]
        }
    };
    expect(privateUpdate(update, 44)).toBe(true);
    expect(privateUpdate(update, 45)).toBe(false);
    expect(privateUpdate({...update, message: {...update.message, chat: {id: 44, type: 'group'}}}, 44)).toBe(false);
    expect(incoming(update)?.text).toBe('Abrir informe\nhttps://portal.example/visor');
});

it('guarda el PDF con el visor y un turno con recordatorios sin duplicarlos al reintentar', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mis-estudios-telegram-'));
    try {
        await writeJson(join(directory, 'google-client.json'), {installed: {client_id: 'test', client_secret: 'test'}});
        await writeJson(join(directory, 'google-authorization.json'), {
            folderId: FOLDER_ID,
            refreshToken: 'test',
            calendar: true
        });
        server.use(http.post('https://oauth2.googleapis.com/token', () => HttpResponse.json({
            access_token: 'test',
            expires_in: 3600
        })));
        const bot = await googleServices(directory, async () => document());
        const studyId = await bot.reserve();
        const study = {
            kind: 'study' as const, id: 1, revision: 0, recordId: studyId, document: {id: 'test', name: 'Informe.pdf'},
            fields: {
                title: 'Ecografía',
                types: ['Ecografía'],
                date: '2024-03-18',
                viewer: 'https://portal.example/visor',
                doctor: '',
                portal: ''
            },
        };
        await bot.save(study);
        await bot.save(study);
        expect(fakeDriveFile(studyId)).toMatchObject({
            mimeType: 'application/pdf',
            appProperties: {misEstudios: 'estudio-v1'}
        });
        expect(JSON.parse(fakeDriveFile(studyId)!.description)).toMatchObject({viewer: 'https://portal.example/visor'});
        const appointmentId = await bot.reserve();
        const appointment = {
            kind: 'appointment' as const, id: 2, revision: 0, recordId: appointmentId,
            fields: {
                date: '2030-11-24',
                time: '15:30',
                professional: 'Dra. Pérez',
                specialty: 'Cardiología',
                location: 'Hospital'
            }
        };
        await bot.save(appointment);
        await bot.save(appointment);
        expect(fakeDriveFile(appointmentId)?.appProperties).toMatchObject({misEstudios: 'turno-v1'});
        expect(fakeCalendars()).toHaveLength(1);
        const events = fakeCalendarEvents(fakeCalendars()[0]!.id);
        expect(events).toHaveLength(1);
        expect(events[0]?.reminders.overrides?.map(item => item.minutes)).toEqual([10350, 1710]);
    } finally {
        await rm(directory, {force: true, recursive: true});
    }
});

it('lee un PDF escaneado usando OCR local en español', async () => {
    const {createCanvas} = await import('@napi-rs/canvas');
    const canvas = createCanvas(1200, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1200, 600);
    ctx.fillStyle = 'black';
    ctx.font = '48px sans-serif';
    ['Estudio: Ecografia', 'Fecha: 18/03/2024', 'Medico: Dra. Ana Perez'].forEach((line, i) => ctx.fillText(line, 70, 100 + i * 100));
    const image = canvas.toBuffer('image/jpeg');
    const content = 'q 600 0 0 300 0 0 cm /Scan Do Q';
    const scan = pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>',
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n${image.toString('latin1')}\nendstream`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ]);
    const file = new File([Buffer.from(scan, 'base64')], 'Escaneo.pdf', {type: 'application/pdf'});
    const result = await readReport(file);
    expect(result).toMatchObject({date: '2024-03-18', types: ['Ecografía']});
}, 20_000);
