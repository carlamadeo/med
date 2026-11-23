import type {TextItem} from 'pdfjs-dist/types/src/display/api';

const isTextItem = (item: object): item is TextItem => 'str' in item;

export function pageText(items: Array<TextItem | object>): string {
    const lines: Array<{ y: number; items: TextItem[] }> = [];
    const ordered = items.filter(isTextItem).filter(item => item.str.length > 0)
        .sort((a, b) => (b.transform[5] ?? 0) - (a.transform[5] ?? 0));
    for (const item of ordered) {
        const y = item.transform[5] ?? 0;
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.y - y) <= 4) line.items.push(item);
        else lines.push({y, items: [item]});
    }
    return lines.map(line => {
        let text = '';
        let end: number | undefined;
        for (const item of line.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))) {
            const x = item.transform[4] ?? 0;
            if (end !== undefined && x - end > 18) text += '  ';
            text += item.str;
            end = Math.max(end ?? x, x + item.width);
        }
        return text;
    }).join('\n');
}
