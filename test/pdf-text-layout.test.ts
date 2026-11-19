import {expect, it} from 'vitest';
import {extractFields} from '@domain/extract';
import {pageText} from '../src/workers/pdf-text-layout';

it('reads labels and values in visual order when the PDF stores them backwards', () => {
    const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({
        str, transform: [1, 0, 0, 1, x, y], width, hasEOL,
    });
    const text = pageText([
        item('12/10/2025 08:50 h', 479, 660, 89),
        item('Fecha:', 449, 660, 27, true),
        item('PEREZ MARIA', 103, 638, 81),
        item('Médico', 47, 638, 28),
        item(' ', 75, 638, 22),
        item(':', 97, 638, 4),
    ]);
    expect(extractFields(text)).toMatchObject({date: '2025-10-12', doctor: 'Perez Maria'});
});
