import {expect, it, vi} from 'vitest';
import {
    clearIntakeReservation,
    listIntakeReservationSources,
    readIntakeReservation,
    reserveIntakeDestination,
} from '@data/intake-reservations';

const draft = {title: 'Informe revisado', date: '2024-02-01', types: ['Otro'], doctor: 'Profesional', portal: '', viewer: '', reportName: ''};

it('reutiliza la reserva por cuenta y origen tras una respuesta incierta', async () => {
    localStorage.clear();
    const reserve = vi.fn().mockResolvedValue('reserved');
    expect(await reserveIntakeDestination('account', 'source', draft, reserve)).toBe('reserved');
    expect(await reserveIntakeDestination('account', 'source', draft, reserve)).toBe('reserved');
    expect(reserve).toHaveBeenCalledTimes(1);
    await expect(reserveIntakeDestination('account', 'source', {...draft, title: 'Cambiado'}, reserve)).rejects.toThrow();
    expect(await reserveIntakeDestination('another-account', 'source', draft, reserve)).toBe('reserved');
    localStorage.clear();
});

it('recupera los datos originales del borrador por cuenta y origen', async () => {
    const owner = 'draft-owner';
    localStorage.clear();
    await reserveIntakeDestination(owner, 'source', draft, async () => 'reserved');
    expect(await readIntakeReservation(owner, 'source')).toMatchObject({id: 'reserved', draft});
    expect(await readIntakeReservation('other-account', 'source')).toBeUndefined();
    expect(localStorage.length).toBe(0);
    localStorage.clear();
});

it('migra solamente las reservas de la cuenta solicitada y conserva el identificador original', async () => {
    const owner = 'cuenta:legada';
    const oldKey = 'mis-estudios:intake-reservation:cuenta%3Alegada:source';
    const otherKey = 'mis-estudios:intake-reservation:otra:source';
    localStorage.setItem(oldKey, JSON.stringify({id: 'id-legado', fingerprint: 'huella-original', draft}));
    localStorage.setItem(otherKey, JSON.stringify({id: 'otro-id', fingerprint: 'otra-huella', draft}));

    expect(await listIntakeReservationSources(owner)).toEqual(['source']);
    expect(localStorage.getItem(oldKey)).toBeNull();
    expect(localStorage.getItem(otherKey)).not.toBeNull();
    expect(await readIntakeReservation(owner, 'source')).toEqual({id: 'id-legado', fingerprint: 'huella-original', draft});
    expect(await readIntakeReservation(owner, 'missing')).toBeUndefined();
    await clearIntakeReservation(owner, 'source', 'otro-id');
    expect(await listIntakeReservationSources(owner)).toEqual(['source']);
    await clearIntakeReservation(owner, 'source', 'id-legado');
    expect(await listIntakeReservationSources(owner)).toEqual([]);
    localStorage.clear();
});

it('reintenta un PDF cuyo identificador y huella fueron guardados por la versión anterior', async () => {
    const owner = 'legacy-upload';
    const key = 'mis-estudios:intake-reservation:legacy-upload:source';
    const file = new File(['%PDF-1.4\n'], 'informe.pdf', {type: 'application/pdf'});
    localStorage.setItem(key, JSON.stringify({
        id: 'previous-id',
        fingerprint: 'f8e74bc20d329a570f59ed12f4a8552ef79b911e1022fe546c3d75c4a7bd6fee',
        draft,
    }));
    const reserve = vi.fn().mockResolvedValue('new-id');
    expect(await reserveIntakeDestination(owner, 'source', {...draft, file}, reserve)).toBe('previous-id');
    expect(reserve).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
});

it('dos reintentos simultáneos convergen en un único ID y no sobrescriben el borrador', async () => {
    const owner = 'concurrent-account';
    const [first, second] = await Promise.all([
        reserveIntakeDestination(owner, 'source', draft, async () => 'one'),
        reserveIntakeDestination(owner, 'source', draft, async () => 'two'),
    ]);
    expect(first).toBe(second);
    expect(await readIntakeReservation(owner, 'source')).toMatchObject({id: first, draft});
});

it('conserva una reserva legada distinta de la reserva actual para revisar el conflicto', async () => {
    const owner = 'conflict-account';
    const oldKey = 'mis-estudios:intake-reservation:conflict-account:source';
    await reserveIntakeDestination(owner, 'source', draft, async () => 'current');
    const prior = JSON.stringify({id: 'prior', fingerprint: 'old', draft});
    localStorage.setItem(oldKey, prior);

    expect(await listIntakeReservationSources(owner)).toEqual(['source']);
    await expect(readIntakeReservation(owner, 'source')).rejects.toThrow('Hay dos reservas');
    expect(localStorage.getItem(oldKey)).toBe(prior);
    localStorage.removeItem(oldKey);
    expect(await readIntakeReservation(owner, 'source')).toMatchObject({id: 'current', draft});
});
