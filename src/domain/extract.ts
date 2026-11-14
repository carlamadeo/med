/**
 * Field extraction from the text of a medical report. Ported from web/extract.js with the same rules:
 * only the types were added. Every comparison goes through `normalize` (accent- and case-insensitive).
 */
import {isValidDate} from './utils';

export interface ExtractedFields {
    date?: string;
    types?: string[];
    doctor?: string;
}

interface Candidate<T> {
    value: T;
    score: number;
}

const months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
const shortMonth: Record<string, number> = Object.fromEntries(
    months.flatMap((month, index) => [
        [month, index + 1],
        [month.slice(0, 3), index + 1],
    ])
);
shortMonth.setiembre = shortMonth.set = 9;
const dateToken =
    /\b(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})|(\d{1,2})(?:\s+de\s+|[-/ ]+)([a-z]+)\.?(?:\s+de(?:l)?\s+|[-/ ]+)(\d{4}))\b/g;

const dateLabel =
    /(?:\bfecha(?:\s+(?:(?:de|del)\s+)?(?:estudio|realizacion|procedimiento|extraccion|toma(?:\s+de\s+muestra)?|adquisicion|examen|prestacion|practica))\b|\bfecha\s+en\s+que\s+se\s+realizo\b|^\s*fecha\s*[:=-])/;
const orderDate = /^fecha\s+y\s+orden\s*[:=-]/;
const unrelatedDate = /\b(?:nacimiento|nac\.?|emision|impresion|validacion|generacion|informe|turno|solicitud|recepcion)\b/;
const strongTypeLabel = /^(?:tipo(?:\s+de\s+estudio)?|estudio(?:\s+realizado)?|procedimiento|examen|practica)\s*[:=-]\s*/;
const typePatterns: Array<[string, RegExp]> = [
    [
        'Análisis de laboratorio',
        /^(?:laboratorio$|(?:analisis|resultados?|informe|estudios?)\s+(?:de\s+)?laboratorio|hemograma|bioquimica|urocultivo|analisis de sangre|deteccion\s+de\s+(?:antigenos?|anticuerpos?))\b/,
    ],
    ['Colonoscopía', /^(?:colonoscop[ií]as?|videocolonoscop[ií]as?)\b/],
    ['Ecografía TV', /^(?:ecograf[ií]as?|ultrasonidos?|eco)\s+(?:tv|transvaginal(?:es)?)\b/],
    ['Ecografía', /^(?:ecograf[ií]as?|ultrasonidos?|ecodoppler|eco\s+doppler|ecografico)\b/],
    ['Electrocardiograma', /^(?:electrocardiogramas?|ecg|ekg)\b/],
    ['Endoscopía', /^(?:endoscop[ií]as?|videoendoscop[ií]as?)\b/],
    ['Mamografía', /^(?:mamograf[ií]as?|mastograf[ií]as?)\b/],
    ['PAP', /^(?:pap|p\.\s*a\.\s*p\.?|papanicolaou)\b/],
    ['Radiografía', /^(?:radiograf[ií]as?|rayos\s+x|rx)\b/],
    ['Resonancia magnética', /^(?:resonancia(?:s)?\s+magnetica(?:s)?|rmn)\b/],
    ['Tomografía', /^(?:tomograf[ií]as?|tac|tc\s+(?:de|multicorte))\b/],
];
const doctorLabel =
    /^(?:m[eé]dic[oa](?:\s+(?:informante|responsable|tratante|firmante))?|profesional(?:\s+(?:informante|responsable|firmante))?|dr\.?\s*\/\s*dra\.?|informado por|firmado(?: digitalmente)? por|firma(?: del profesional)?)\s*[:=-]\s*(.*)$/iu;
const headerDoctorLabel =
    /^(?:(?:m[eé]dic[oa]|profesional)(?:\s+(?:solicitante|tratante|derivante))?|solicitante|derivante)\s*[:=-]\s*(.*)$/iu;
const genericDoctorTitle = /^dr\.?\s*\/\s*(?:dra\.?|a)(?:\s*[:=-]\s*|\s+)(.*)$/iu;
const honorific = /^dr(?:a)?\.?\s+/iu;
const registration =
    /(?:[\s,]+(?:m\.?\s*[np]\.?|matr[ií]cula|especialidad)\s*[:.\d]|[\s,]+\d|\s*[|;]).*$/iu;

const normalize = (value: string): string => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function dates(line: string): string[] {
    return Array.from(line.matchAll(dateToken), (match) => {
        const [, y1, m1, d1, d2, m2, y2, d3, m3, y3] = match;
        const month = m1 || m2 || shortMonth[m3 ?? ''];
        if (!month) return '';
        return [y1 || y2 || y3, String(month).padStart(2, '0'), (d1 || d2 || d3 || '').padStart(2, '0')].join('-');
    }).filter(isValidDate);
}

function strongest(candidates: Array<Candidate<string>>): string | undefined {
    const top = Math.max(...candidates.map((item) => item.score));
    const values = new Map(
        candidates.filter((item) => item.score === top).map((item) => [normalize(item.value), item.value] as const)
    );
    return values.size === 1 ? values.values().next().value : undefined;
}

function strongestTypes(candidates: Array<Candidate<string>>): string[] {
    const top = Math.max(...candidates.map((item) => item.score));
    return [...new Set(candidates.filter((item) => item.score === top).map((item) => item.value))];
}

function doctorName(text: string): string | undefined {
    const value = (text.split(/\s{2,}/)[0] ?? '').replace(registration, '').trim();
    const name = value.replace(honorific, '').replace(/,\s*/g, ' ');
    if (
        name.length <= 95 &&
        /^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){1,8}$/u.test(name) &&
        !/\b(?:paciente|sin firma|no disponible|solicitante|derivante|servicio|especialidad)\b/.test(normalize(name))
    ) {
        return value;
    }
    return undefined;
}

export function extractSignatureDoctor(text: string): string | undefined {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const names = lines
        .filter((line) => honorific.test(line))
        .map(doctorName)
        .filter((name): name is string => Boolean(name));
    return strongest(names.map((value) => ({value, score: 1})));
}

export function extractFields(text: string): ExtractedFields {
    const candidates: {
        date: Array<Candidate<string>>;
        types: Array<Candidate<string>>;
        doctor: Array<Candidate<string>>
    } = {
        date: [],
        types: [],
        doctor: [],
    };
    for (const page of text.split('\f')) {
        const lines = page
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        for (const [index, line] of lines.entries()) {
            const folded = normalize(line);
            const cells = folded.split(/\s{2,}|\t+/);
            for (const [column, cell] of cells.entries()) {
                if (unrelatedDate.test(cell) || !(dateLabel.test(cell) || orderDate.test(cell))) continue;
                const found = dates(cell);
                if (!found.length) {
                    const next = cells[column + 1] || (cells.length === 1 ? normalize(lines[index + 1] || '') : '');
                    const nextDates = dates(next);
                    if (/^\d/.test(next) && !unrelatedDate.test(next) && nextDates.length === 1) found.push(...nextDates);
                }
                const score = /^fecha\s*[:=-]/.test(cell) ? 1 : orderDate.test(cell) ? 2 : 3;
                for (const value of found) candidates.date.push({value, score});
            }

            const labeled = strongTypeLabel.test(folded);
            if (labeled || index < 26) {
                const heading = folded.replace(strongTypeLabel, '').replace(/^informe\s+(?:de\s+)?/, '');
                if (heading.length <= 105) {
                    for (const [value, pattern] of typePatterns) {
                        if (pattern.test(heading)) {
                            candidates.types.push({value, score: labeled ? 3 : 1});
                            break;
                        }
                    }
                }
            }

            const label = doctorLabel.exec(line);
            const signature =
                honorific.test(line) &&
                (registration.test(line) || /^(?:m\.?\s*[np]\.?|matricula)\s*[:.\d]/.test(normalize(lines[index + 1] || '')));
            const header = headerDoctorLabel.exec(line) || genericDoctorTitle.exec(line);
            const bareHeader = index < 12 && honorific.test(line) && !signature;
            if (header || bareHeader) {
                const next = lines[index + 1] || '';
                const value = doctorName(header ? header[1] || (honorific.test(next) ? next : '') : line);
                if (value) candidates.doctor.push({value, score: 4});
            }
            if (label || signature) {
                const next = lines[index + 1] || '';
                const value = doctorName(label ? label[1] || (honorific.test(next) ? next : '') : line);
                if (value) {
                    const isSignature = /firm|informante|informado/i.test(label?.[0] || '');
                    candidates.doctor.push({value, score: isSignature ? 3 : label ? 2 : 1});
                }
            }
        }
    }

    const result: ExtractedFields = {};
    const date = candidates.date.length ? strongest(candidates.date) : undefined;
    if (date) result.date = date;
    const types = candidates.types.length ? strongestTypes(candidates.types) : [];
    if (types.length) result.types = types;
    const doctor = candidates.doctor.length ? strongest(candidates.doctor) : undefined;
    if (doctor) result.doctor = doctor;
    return result;
}
