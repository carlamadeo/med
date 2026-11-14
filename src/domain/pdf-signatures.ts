import type * as PdfJs from 'pdfjs-dist';

type Region = [number, number, number, number];
type Transform = [number, number, number, number, number, number];

interface OperatorList {
    fnArray: number[];
    argsArray: unknown[];
}

/** Bounding boxes of images that look like a signature stamp near the foot of the page. */
export function signatureImages(
    operators: OperatorList,
    pdfjs: Pick<typeof PdfJs, 'OPS' | 'Util'>,
    view: number[]
): Region[] {
    const {OPS, Util} = pdfjs;
    const [viewLeft = 0, viewBottom = 0, viewRight = 0, viewTop = 0] = view;
    const stack: Transform[] = [];
    let transform: Transform = [1, 0, 0, 1, 0, 0];
    const regions: Region[] = [];
    const paints: number[] = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject];
    for (let i = 0; i < operators.fnArray.length; i++) {
        const op = operators.fnArray[i] as number;
        if (op === OPS.save) stack.push(transform);
        else if (op === OPS.restore) transform = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (op === OPS.transform) transform = Util.transform(transform, operators.argsArray[i] as number[]) as Transform;
        else if (paints.includes(op)) {
            const [a, b, c, d, e, f] = transform;
            const left = Math.max(viewLeft, Math.min(e, e + a, e + c, e + a + c));
            const right = Math.min(viewRight, Math.max(e, e + a, e + c, e + a + c));
            const bottom = Math.max(viewBottom, Math.min(f, f + b, f + d, f + b + d));
            const top = Math.min(viewTop, Math.max(f, f + b, f + d, f + b + d));
            const height = viewTop - viewBottom;
            // Look for stamps near the foot of the page, without re-reading full-page scans.
            if (right - left >= 60 && top - bottom >= 15 && top - bottom <= height * 0.4 && top <= viewBottom + height * 0.65) {
                regions.push([left, bottom, right, top]);
            }
        }
    }
    return regions;
}

