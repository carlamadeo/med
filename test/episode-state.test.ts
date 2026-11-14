import {afterEach, expect, it} from 'vitest';
import {episodes, pendingChanges, visibleEpisodes} from '../src/presentation/state/store';

afterEach(() => {
    episodes.value = [];
    pendingChanges.value = [];
});

it('shows an offline episode with its pending status', () => {
    pendingChanges.value = [{
        id: 1,
        owner: 'owner',
        kind: 'episode-save',
        status: 'pending',
        episodeDraft: {illness: 'Gripe'}
    }];
    expect(visibleEpisodes.value).toMatchObject([{
        illness: 'Gripe',
        observations: [],
        medications: [],
        syncStatus: 'pending'
    }]);
});

it('shows a pending deletion on the episode instead of making it look synchronized', () => {
    episodes.value = [{id: 'one', illness: 'Gripe', observations: [], medications: [], revision: '1'}];
    pendingChanges.value = [{
        id: 1,
        owner: 'owner',
        kind: 'episode-delete',
        episodeId: 'one',
        revision: '1',
        status: 'pending'
    }];
    expect(visibleEpisodes.value).toMatchObject([{id: 'one', syncStatus: 'pending'}]);
});
