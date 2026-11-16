import {expect, it, vi} from 'vitest';
import {reserveIntakeDestination} from '@presentation/utils/intakeReservation';

it('reutiliza la reserva por cuenta y origen tras una respuesta incierta', async () => {
    localStorage.clear();
    const reserve = vi.fn().mockResolvedValue('reserved');
    const draft = {title: 'Estudio', date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: ''};
    expect(await reserveIntakeDestination('account', 'source', draft, reserve)).toBe('reserved');
    expect(await reserveIntakeDestination('account', 'source', draft, reserve)).toBe('reserved');
    expect(reserve).toHaveBeenCalledTimes(1);
    await expect(reserveIntakeDestination('account', 'source', {...draft, title: 'Cambiado'}, reserve)).rejects.toThrow();
    expect(await reserveIntakeDestination('another-account', 'source', draft, reserve)).toBe('reserved');
    localStorage.clear();
});

it('recupera los datos originales del borrador por cuenta y origen', async () => {
    const {readIntakeDraft} = await import('@presentation/utils/intakeReservation');
    localStorage.clear();
    const draft = {title: 'Informe revisado', date: '2024-02-01', types: ['Otro'], doctor: 'Profesional', portal: '', viewer: '', reportName: ''};
    await reserveIntakeDestination('account', 'source', draft, async () => 'reserved');
    expect(readIntakeDraft('account', 'source')).toEqual(draft);
    expect(readIntakeDraft('other-account', 'source')).toBeNull();
    localStorage.clear();
});
