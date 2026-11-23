import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DEFAULT_APPOINTMENT_TIME_ZONE} from '@domain/appointments';
import {createConversation, type BotState} from './conversation';
import {authorizeGoogle, googleServices} from './google';
import {readReport} from './pdf';
import {readJson, writeJson} from './private-state';
import {incoming, privateUpdate, telegramClient} from './telegram';

const directory = process.env.TELEGRAM_STATE_DIR || '.data/telegram';

function todayInBuenosAires(): string {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: DEFAULT_APPOINTMENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}

async function run() {
    const mode = process.argv[2] ?? 'run';
    if (mode === 'authorize') {
        await authorizeGoogle(directory, process.argv.includes('--calendar'));
        return;
    }
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token || !/^\d+:[\w-]+$/.test(token)) throw new Error('Configurá TELEGRAM_BOT_TOKEN en el archivo local de entorno.');
    const telegram = telegramClient(token);
    if (mode === 'identify') {
        const code = 'vincular-' + randomBytes(8).toString('hex');
        console.log(`Mandá este texto al bot en un chat privado: ${code}`);
        let offset: number | undefined;
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
            for (const update of await telegram.updates(offset)) {
                const message = update.message;
                if (message?.text === code && message.chat.type === 'private' && message.from?.id === message.chat.id) {
                    console.log(`TELEGRAM_OWNER_ID=${message.chat.id}`);
                    return;
                }
                offset = update.update_id + 1;
            }
        }
        throw new Error('Venció el código. Volvé a ejecutar identify.');
    }
    const owner = Number(process.env.TELEGRAM_OWNER_ID);
    if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('Configurá TELEGRAM_OWNER_ID con tu ID numérico de Telegram.');
    if (mode !== 'run') throw new Error('Usá run, identify o authorize.');

    const {folderId, ...google} = await googleServices(directory, telegram.download);
    const path = join(directory, `state-${owner}-${folderId}.json`);
    const state = await readJson<BotState>(path) ?? {};
    const persist = () => writeJson(path, state);
    const talk = createConversation(state, {
        ...google, persist, send: (text, buttons) => telegram.send(owner, text, buttons),
        analyze: async ref => readReport(await telegram.download(ref)), today: todayInBuenosAires,
    });
    console.log('Bot activo. Los borradores se guardan en el directorio local configurado.');
    let stopped = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
        stopped = true;
    });
    while (!stopped) {
        try {
            for (const update of await telegram.updates(state.offset)) {
                if (stopped) break;
                if (privateUpdate(update, owner)) {
                    const callback = update.callback_query;
                    if (callback) await telegram.answer(callback.id).catch(() => {
                    });
                    const input = incoming(update);
                    if (input) await talk(input);
                }
                const offset = update.update_id + 1;
                await writeJson(path, {...state, offset});
                state.offset = offset;
            }
        } catch {
            console.error('No se pudo completar una operación del bot. Se reintentará en unos segundos.');
            if (!stopped) await delay(5000);
        }
    }
}

run().catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('Falta un archivo de configuración del bot. Revisá la guía de activación.');
    } else {
        console.error(error instanceof Error ? error.message : 'El bot no pudo iniciar.');
    }
    process.exitCode = 1;
});
