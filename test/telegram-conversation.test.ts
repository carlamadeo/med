import {describe, expect, it, vi} from 'vitest';
import {createConversation, type BotState} from '../src/bot/conversation';

function fixture() {
    const state: BotState = {};
    const send = vi.fn();
    const reserve = vi.fn(async () => 'reserved');
    const save = vi.fn(async () => 'Guardado.');
    const analyze = vi.fn(async () => ({date: '2026-11-10', types: ['Ecografía'], doctor: 'Dra. Pérez'}));
    const talk = createConversation(state, {
        send, reserve, save, analyze, persist: async () => {
        }, today: () => '2026-11-21'
    });
    const message = (text: string, id = 10) => talk({id, text});
    return {state, send, reserve, save, analyze, message, talk};
}

describe('bot de Telegram', () => {
    it('confirma un PDF con visor y rechaza botones de una revisión anterior', async () => {
        const {state, talk, save, send} = fixture();
        await talk({id: 1, document: {id: 'pdf', name: 'Informe.pdf'}, text: 'https://portal.example/visor?a=1'});
        expect(state.draft?.fields).toMatchObject({viewer: 'https://portal.example/visor?a=1', types: ['Ecografía']});
        expect(save).not.toHaveBeenCalled();
        await talk({id: 2, action: 'viewer:1:0'});
        await talk({id: 3, text: 'https://portal.example/otro'});
        await talk({id: 4, action: 'save:1:0'});
        expect(save).not.toHaveBeenCalled();
        await talk({id: 5, action: 'save:1:1'});
        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            recordId: 'reserved',
            fields: expect.objectContaining({viewer: 'https://portal.example/otro'})
        }));
        expect(send).toHaveBeenLastCalledWith('Guardado.');
    });

    it('permite completar o cancelar un estudio con solo el enlace', async () => {
        const {message, talk, state, save} = fixture();
        await message('https://portal.example/visor');
        await talk({id: 11, action: 'save:10:0'});
        expect(save).not.toHaveBeenCalled();
        await message('Nombre: Informe\nFecha: 10/11/2026\nTipo: Mamografía', 12);
        expect(state.draft?.fields).toMatchObject({date: '2026-11-10', types: ['Mamografía']});
        await talk({id: 13, action: 'cancel:10:1'});
        expect(state.draft).toBeUndefined();
        expect(save).not.toHaveBeenCalled();
    });

    it('confirma un turno escrito y conserva el ID en un reintento', async () => {
        const {message, talk, state, save, reserve} = fixture();
        await message('Turno con la Dra. Pérez el martes a las 15:30 en el Hospital Italiano');
        expect(state.draft?.fields).toMatchObject({
            date: '2026-11-24',
            time: '15:30',
            professional: 'Dra. Pérez',
            location: 'el Hospital Italiano'
        });
        save.mockRejectedValueOnce(new Error('Prueba'));
        await talk({id: 11, action: 'save:10:0'});
        expect(save).toHaveBeenCalledTimes(1);
        expect(state.draft?.recordId).toBe('reserved');
        await talk({id: 12, action: 'save:10:0'});
        expect(reserve).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(2);
    });
});
