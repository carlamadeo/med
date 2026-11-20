import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it} from 'vitest';
import {Episodes} from '@presentation/components/Episodes';
import {episodes} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    root.remove();
    episodes.value = [];
});

it('shows observations in date order and groups occurrences by illness', async () => {
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
    expect(root.textContent).toContain('3 días');
    expect(root.textContent).toContain('fiebre');
    expect(root.textContent!.indexOf('Fiebre')).toBeLessThan(root.textContent!.indexOf('Mejor'));
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

it('includes the recorded end date in the illness duration', async () => {
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
    expect(root.querySelector('.episode-title')?.textContent).toContain('Finalizado · 4 días');
    expect(root.querySelector('time[datetime="2024-03-12"]')).not.toBeNull();
});
