export function validDate(date) {
  const instant = new Date(date + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1900-01-01' &&
    Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}

const months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
const shortMonth = Object.fromEntries(months.flatMap((month, index) =>
  [[month, index + 1], [month.slice(0, 3), index + 1]]));
shortMonth.setiembre = shortMonth.set = 9;
const dateToken = /\b(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})|(\d{1,2})(?:\s+de\s+|[-/ ]+)([a-z]+)\.?(?:\s+de(?:l)?\s+|[-/ ]+)(\d{4}))\b/g;

const dateLabel = /(?:\bfecha(?:\s+(?:(?:de|del)\s+)?(?:estudio|realizacion|procedimiento|extraccion|toma(?:\s+de\s+muestra)?|adquisicion|examen|prestacion|practica))\b|\bfecha\s+en\s+que\s+se\s+realizo\b|^\s*fecha\s*[:=-])/;
const unrelatedDate = /\b(?:nacimiento|nac\.?|emision|impresion|validacion|informe|turno|solicitud|recepcion)\b/;
const strongTypeLabel = /^(?:tipo(?:\s+de\s+estudio)?|estudio(?:\s+realizado)?|procedimiento|examen|practica)\s*[:=-]\s*/;
const typePatterns = [
  ['Análisis de laboratorio', /^(?:laboratorio|(?:analisis|resultados?|informe|estudios?)\s+(?:de\s+)?laboratorio|hemograma|bioquimica|urocultivo|analisis de sangre)\b/],
  ['Ecografía', /^(?:ecograf[ií]as?|ultrasonidos?|ecodoppler|eco\s+doppler|ecografico)\b/],
  ['Electrocardiograma', /^(?:electrocardiogramas?|ecg|ekg)\b/],
  ['Endoscopía', /^(?:endoscop[ií]as?|videoendoscop[ií]as?|colonoscop[ií]as?|videocolonoscop[ií]as?)\b/],
  ['Mamografía', /^(?:mamograf[ií]as?|mastograf[ií]as?)\b/],
  ['Radiografía', /^(?:radiograf[ií]as?|rayos\s+x|rx)\b/],
  ['Resonancia magnética', /^(?:resonancia(?:s)?\s+magnetica(?:s)?|rmn)\b/],
  ['Tomografía', /^(?:tomograf[ií]as?|tac|tc\s+(?:de|multicorte))\b/],
];
const doctorLabel = /^(?:m[eé]dic[oa](?:\s+(?:informante|responsable|tratante|firmante))?|profesional(?:\s+(?:informante|responsable|firmante))?|informado por|firmado(?: digitalmente)? por|firma(?: del profesional)?)\s*[:=-]\s*(.*)$/iu;
const honorific = /^dr(?:a)?\.?\s+/iu;
const registration = /(?:\s+(?:m\.?\s*[np]\.?|matr[ií]cula|especialidad)\s*[:.\d]|\s+\d|\s*[|;,]).*$/iu;
const normalize = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function dates(line) {
  return Array.from(line.matchAll(dateToken), (match) => {
    const [, y1, m1, d1, d2, m2, y2, d3, m3, y3] = match;
    const month = m1 || m2 || shortMonth[m3];
    if (!month) return '';
    return [y1 || y2 || y3, String(month).padStart(2, '0'), (d1 || d2 || d3).padStart(2, '0')].join('-');
  }).filter(validDate);
}

function strongest(candidates) {
  const top = Math.max(...candidates.map((item) => item.score));
  const values = new Map(candidates.filter((item) => item.score === top)
    .map((item) => [normalize(item.value), item.value]));
  return values.size === 1 ? values.values().next().value : undefined;
}

export function extractFields(text) {
  const candidates = { date: [], type: [], doctor: [] };
  for (const page of text.split('\f')) {
    const lines = page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const folded = normalize(line);
      if (dateLabel.test(folded)) {
        const generic = /^fecha\s*[:=-]/.test(folded);
        const cells = folded.split(/\s{2,}|\t+/);
        for (const cell of cells.filter((item) => dateLabel.test(item) && !unrelatedDate.test(item))) {
          const found = dates(cell);
          if (!found.length && cells.length === 1 && !unrelatedDate.test(normalize(lines[index + 1] || ''))) {
            const next = normalize(lines[index + 1] || '');
            const nextDates = dates(next);
            if (/^\d/.test(next) && nextDates.length === 1) found.push(...nextDates);
          }
          for (const value of found) candidates.date.push({ value, score: generic ? 1 : 3 });
        }
      }

      const labeled = strongTypeLabel.test(folded);
      if (labeled || index < 18) {
        const heading = folded.replace(strongTypeLabel, '').replace(/^informe\s+(?:de\s+)?/, '');
        if (heading.length <= 105) {
          for (const [value, pattern] of typePatterns) {
            if (pattern.test(heading)) candidates.type.push({ value, score: labeled ? 3 : 1 });
          }
        }
      }

      const label = doctorLabel.exec(line);
      const signature = honorific.test(line) && (registration.test(line) || /^(?:m\.?\s*[np]\.?|matricula)\s*[:.\d]/.test(normalize(lines[index + 1] || '')));
      if (label || signature) {
        let value = (label ? label[1] || lines[index + 1] || '' : line).split(/\s{2,}/)[0].replace(registration, '').trim();
        const name = value.replace(honorific, '');
        if (name.length <= 95 && /^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){1,8}$/u.test(name) &&
          !/\b(?:paciente|sin firma|no disponible|solicitante|derivante|servicio|especialidad)\b/.test(normalize(name))) {
          const isSignature = /firm|informante|informado/i.test(label?.[0] || '');
          candidates.doctor.push({ value, score: isSignature ? 3 : label ? 2 : 1 });
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(candidates).flatMap(([key, items]) => {
    const value = strongest(items);
    return value ? [[key, value]] : [];
  }));
}
