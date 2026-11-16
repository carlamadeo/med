import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {mountPage} from './page';

it('informa el directorio que falló y permite reintentar desde Resumen', async () => {
    const {driveAppointmentRepo} = await import('@data');
    const list = vi.spyOn(driveAppointmentRepo, 'list').mockRejectedValueOnce(new Error('Error de prueba'));
    await mountPage();
    const {view} = await import('@presentation/state/store');
    await act(() => { view.value = 'resumen'; });
    await vi.waitFor(() => expect(document.body.textContent).toContain('No se pudieron cargar: Turnos'));
    expect(document.body.textContent).not.toContain('Todo sincronizado con Drive.');
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Reintentar carga'))!;
    await act(() => retry.click());
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('No se pudieron cargar: Turnos'));
});
