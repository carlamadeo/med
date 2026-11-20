// A self-contained synthetic report. No patient documents or Google credentials are used.
export function pdf(objects: string[]) {
    let content = '%PDF-1.4\n';
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(content, 'latin1'));
        content += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(content, 'latin1');
    content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    content += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(content, 'latin1').toString('base64');
}
