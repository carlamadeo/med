import type {Button, DocumentRef, Incoming} from './conversation';
import {validateDocument} from '@data/pdf-analysis';

interface Message {
    from?: {id: number};
    chat: {id: number; type: string};
    text?: string;
    caption?: string;
    entities?: Entity[];
    caption_entities?: Entity[];
    document?: {file_id: string; file_name?: string; mime_type?: string; file_size?: number};
}
interface Entity {type: string; url?: string}
export interface Update {
    update_id: number;
    message?: Message;
    callback_query?: {id: string; from: {id: number}; data?: string; message?: Message};
}

const MAX_BYTES = 20 * 1024 * 1024;

export function privateUpdate(update: Update, owner: number): boolean {
    const callback = update.callback_query;
    const message = update.message ?? callback?.message;
    return message?.chat.type === 'private' && message.chat.id === owner &&
        (callback?.from.id ?? message.from?.id) === owner;
}

export function incoming(update: Update): Incoming | undefined {
    if (update.callback_query?.data) {
        return {id: update.update_id, action: update.callback_query.data};
    }
    const message = update.message;
    if (!message) return;
    const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
    const links = entities.filter(entity => entity.type === 'text_link' && entity.url).map(entity => entity.url);
    const text = [message.text ?? message.caption ?? '', ...links].join('\n').trim();
    return {
        id: update.update_id, text,
        ...(message.document ? {
            document: {id: message.document.file_id, name: message.document.file_name ?? 'Informe.pdf'},
        } : {}),
    };
}

export function telegramClient(token: string) {
    async function api<T>(method: string, payload: object, timeout = 20_000): Promise<T> {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
            redirect: 'error', signal: AbortSignal.timeout(timeout),
        });
        const body = await response.json() as {ok: boolean; result: T};
        if (!response.ok || !body.ok) throw new Error(`Telegram rechazó ${method} (${response.status}).`);
        return body.result;
    }
    return {
        updates: (offset?: number) => api<Update[]>('getUpdates', {
            offset, timeout: 25, allowed_updates: ['message', 'callback_query'],
        }, 35_000),
        answer: (id: string) => api('answerCallbackQuery', {callback_query_id: id}),
        async send(chatId: number, text: string, buttons?: Button[][]) {
            await api('sendMessage', {
                chat_id: chatId, text: Array.from(text).slice(0, 4000).join(''),
                link_preview_options: {is_disabled: true},
                ...(buttons?.length ? {reply_markup: {inline_keyboard: buttons}} : {}),
            });
        },
        async download(ref: DocumentRef): Promise<File> {
            const info = await api<{file_path?: string; file_size?: number}>('getFile', {file_id: ref.id});
            if (!info.file_path || (info.file_size ?? 0) > MAX_BYTES) throw new Error('El PDF supera el límite de Telegram.');
            const path = info.file_path.split('/').map(encodeURIComponent).join('/');
            const response = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
                redirect: 'error', signal: AbortSignal.timeout(45_000),
            });
            if (!response.ok || !response.body) throw new Error('Telegram no devolvió el PDF.');
            const reader = response.body.getReader();
            const chunks: Uint8Array<ArrayBuffer>[] = [];
            let size = 0;
            try {
                for (;;) {
                    const result = await reader.read();
                    if (result.done) break;
                    size += result.value.length;
                    if (size > MAX_BYTES) throw new Error('El PDF supera el límite de Telegram.');
                    chunks.push(Uint8Array.from(result.value));
                }
            } finally {
                await reader.cancel().catch(() => {});
            }
            const file = new File(chunks, ref.name, {type: 'application/pdf'});
            if (await validateDocument(file) !== 'application/pdf') throw new Error('El adjunto tiene que ser un PDF.');
            return file;
        },
    };
}
