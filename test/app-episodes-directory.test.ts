import {act} from 'preact/test-utils';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {episodes, view} from '@presentation/state/store';
import type {Episode} from '@domain/models';
import {$, mountPage, typeInto} from './page';

const flu: Episode = {
    id: 'e1',
    illness: 'Gripe',
    revision: '1',
    observations: [{date: '2026-10-28', text: 'Fiebre', symptoms: []}],
    medications: [],
};

const back: Episode = {
    id: 'e2',
    illness: 'Lumbalgia',
    revision: '1',
    observations: [{date: '2026-08-10', text: 'Dolor lumbar', symptoms: []}],
    medications: [],
};

beforeAll(async () => {
    localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    await mountPage();
});

beforeEach(() => {
    act(() => {
        view.value = 'episodios';
    });
});

async function openEpisodes() {
    act(() => {
        $<HTMLButtonElement>('#tab-episodios').click();
    });
}

describe('episodes directory', () => {
    it('filters episodes by illness', async () => {
        await openEpisodes();
        act(() => {
            episodes.value = [flu, back];
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#episodes-list .episode-card')).toHaveLength(2));

        await act(async () => {
            typeInto('#episode-search', 'gripe');
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#episodes-list .episode-card')).toHaveLength(1));
    });

    it('opens the new episode dialog and creates an episode', async () => {
        await openEpisodes();
        await act(async () => {
            typeInto('#episode-search', '');
        });
        act(() => {
            episodes.value = [];
        });

        act(() => {
            [...document.querySelectorAll<HTMLButtonElement>('.episodes-head-actions button')]
                .find((button) => button.textContent?.includes('Nuevo episodio'))?.click();
        });
        await vi.waitFor(() => expect($('#episode-dialog')?.hasAttribute('open')).toBe(true));

        typeInto('#episode-form input[name="illness"]', 'Migraña');
        await act(async () => {
            $<HTMLFormElement>('#episode-form').requestSubmit();
        });

        await vi.waitFor(() => expect(episodes.value.some((episode) => episode.illness === 'Migraña')).toBe(true));
        expect($('#episodes-list')?.textContent).toContain('Migraña');
    });
});