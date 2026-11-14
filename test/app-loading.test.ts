import {http, HttpResponse} from 'msw';
import {expect, it, vi} from 'vitest';
import {mountPage} from './page';
import {server} from './server';

it('shows accessible loading feedback and placeholder cards until the library loads', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
        finish = resolve;
    });
    server.use(http.get('https://www.googleapis.com/drive/v3/files', async ({request}) => {
        if (!(new URL(request.url).searchParams.get('q') ?? '').includes('estudio-v1')) return;
        await gate;
        return HttpResponse.json({files: []});
    }));
    await mountPage();
    expect(document.querySelector('#list-status')?.textContent).toContain('Cargando');
    expect(document.querySelectorAll('.skeleton-card')).toHaveLength(3);
    expect(document.querySelector('.skeleton-list')?.getAttribute('aria-hidden')).toBe('true');
    finish();
    await vi.waitFor(() => expect(document.querySelector('.skeleton-list')).toBeNull());
});
