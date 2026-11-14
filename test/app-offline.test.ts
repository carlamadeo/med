import {http, HttpResponse} from 'msw';
import {beforeAll, expect, it, vi} from 'vitest';
import {mountPage, rowIds} from './page';
import {server} from './server';

beforeAll(() => {
    server.use(http.get('https://www.googleapis.com/drive/v3/files', ({request}) => {
        const query = new URL(request.url).searchParams.get('q') ?? '';
        if (query.includes('operacion-v1') || query.includes('portal-v1')) return HttpResponse.error();
    }));
});

it('keeps the study library usable if the operation and portal directories fail to load', async () => {
    await mountPage();
    await vi.waitFor(() => expect(rowIds()).toEqual(['study-2', 'study-1']));
    await vi.waitFor(() => expect(document.querySelector('#directory-warning')?.textContent).toContain('operaciones y portales'));
});
