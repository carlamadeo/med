import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {Episodes} from '@presentation/components/Episodes';
import {episodes} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    root.remove();
    episodes.value = [];
    vi.useRealTimers();
});

it('allows switching back from a period with no episodes', async () => {
    vi.setSystemTime(new Date(2026, 10, 21, 12));
    episodes.value = [{
        id: 'old', illness: 'Otitis', revision: '1', medications: [],
        observations: [{date: '2025-12-10', symptoms: [], text: ''}],
    }];
    document.body.append(root);
    await act(() => render(h(Episodes, {}), root));
    const periodButton = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('.episodes-summary button')]
        .find(button => button.textContent?.trim() === name);

    await act(() => periodButton('Año actual')!.click());
    expect(root.querySelector('.episodes-summary')?.textContent).toContain('No hay episodios');
    expect(periodButton('12 meses')).toBeDefined();
    await act(() => periodButton('12 meses')!.click());
    expect(root.querySelector('.episodes-summary')?.textContent).toContain('Otitis');
});

it('shows episodes in summary view with key metrics', async () => {
    episodes.value = [
        {
            id: '1',
            illness: 'Gripe',
            revision: '1',
            medications: [],
            observations: [{date: '2024-01-03', text: 'Mejor', symptoms: []}, {
                date: '2024-01-01',
                text: 'Fiebre',
                symptoms: [{name: 'fiebre', intensity: 3}]
            }]
        },
        {
            id: '2',
            illness: 'Gripe',
            revision: '1',
            medications: [],
            observations: [{date: '2024-02-01', text: 'Otra vez', symptoms: []}]
        },
    ];
    document.body.append(root);
    await act(() => {
        render(h(Episodes, {}), root);
    });
    expect(root.textContent).toContain('2 episodios');
    expect(root.textContent).toContain('Gripe');
    expect(root.textContent).toContain('fiebre');
});

it('shows episode summary with duration and symptoms', async () => {
    episodes.value = [{
        id: '1',
        illness: 'Otitis',
        revision: '1',
        closed: true,
        endDate: '2024-03-12',
        medications: [],
        observations: [{date: '2024-03-09', text: 'Dolor', symptoms: []}],
    }];
    document.body.append(root);
    await act(() => render(h(Episodes, {}), root));
    expect(root.textContent).toContain('Otitis');
    expect(root.textContent).toContain('Finalizado');
    expect(root.textContent).toContain('4 días');
    expect(root.querySelector('time[datetime="2024-03-12"]')).not.toBeNull();
});

it('offers previously used medications as suggestions', async () => {
    episodes.value = [{
        id: '1',
        illness: 'Gripe',
        revision: '1',
        observations: [],
        medications: [{name: 'Paracetamol'}]
    }];
    document.body.append(root);
    await act(() => {
        render(h(Episodes, {}), root);
    });
    const input = root.querySelector<HTMLInputElement>('input[placeholder="Nombre del medicamento"]')!;
    const list = root.querySelector<HTMLDataListElement>(`#${input.getAttribute('list')}`);
    expect([...list!.options].map(option => option.value)).toContain('Paracetamol');
});

it('expands episode detail when clicking expand button', async () => {
    episodes.value = [{
        id: '1',
        illness: 'Gripe',
        revision: '1',
        medications: [],
        observations: [{date: '2024-01-01', text: 'Fiebre alta', symptoms: [{name: 'fiebre', intensity: 4}]}],
    }];
    document.body.append(root);
    await act(() => {
        render(h(Episodes, {}), root);
    });
    // In collapsed view, symptom name is shown
    expect(root.textContent).toContain('fiebre');
    
    const expandButton = root.querySelector<HTMLButtonElement>('button[aria-label="Ver detalle completo"]')!;
    await act(() => expandButton.click());
    // In expanded view, observation text is shown
    expect(root.textContent).toContain('Fiebre alta');
    expect(root.textContent).toContain('Editar');
    expect(root.textContent).toContain('Eliminar');
});
