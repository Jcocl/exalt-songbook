import { isChord, parseChordLine, parseSheet, splitSheets } from './music.js';

const MAX_BYTES = 15 * 1024 * 1024;
const SECTION = /^(?:intro|verse|pre[- ]?chorus|chorus|bridge|interlude|instrumental|turnaround|outro|ending|refrain|tag|vamp|solo|repeat)(?:\b|\d)/i;
const clean = text => String(text || '').replace(/\u0000/g, '').trim();
const isSection = text => SECTION.test(String(text).replace(/^[\s\[({]+|[\s\])}:]+$/g, ''));

export function parseImportText(text) {
  const candidates = splitSheets(text);
  return { candidates, sourceText: String(text || ''), warnings: [] };
}

function assembleLine(items) {
  let text = ''; const positions = []; let previousEnd = null;
  for (const item of items.sort((a, b) => a.x - b.x)) {
    const width = item.width || item.size * item.str.length * 0.5;
    const unit = width / Math.max(item.str.length, 1);
    if (previousEnd !== null && item.x - previousEnd > Math.max(1.5, unit * 0.35) && !text.endsWith(' ') && !item.str.startsWith(' ')) {
      text += ' '; positions.push(previousEnd);
    }
    for (let i = 0; i < item.str.length; i++) { text += item.str[i]; positions.push(item.x + unit * i); }
    previousEnd = item.x + width;
  }
  const trim = text.length - text.trimStart().length;
  return { text: text.trim(), positions: positions.slice(trim, text.trimEnd().length), y: items[0].y, size: Math.max(...items.map(i => i.size)), bold: items.some(i => /bold/i.test(i.fontName || '')) };
}

function columnLines(items) {
  const groups = [];
  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let group = groups.find(g => Math.abs(g.y - item.y) < Math.max(1.6, item.size * .16));
    if (!group) { group = { y: item.y, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups.sort((a, b) => b.y - a.y).map(group => assembleLine(group.items)).filter(line => line.text);
}

function geometryChords(line) {
  const chords = parseChordLine(line.text);
  return chords?.map(({ chord, position }) => ({ chord, x: line.positions[position] ?? line.positions[0] ?? 0 })) || null;
}

function alignLine(chords, lyric) {
  const inserts = new Map();
  for (const chord of chords) {
    let index = lyric.text.length;
    if (lyric.positions.length && chord.x <= lyric.positions.at(-1) + 4) {
      let delta = Infinity;
      for (let i = 0; i < lyric.positions.length; i++) {
        const d = Math.abs(lyric.positions[i] - chord.x);
        if (d < delta) { index = i; delta = d; }
      }
    }
    inserts.set(index, `${inserts.get(index) || ''}[${chord.chord}]`);
  }
  return Array.from({ length: lyric.text.length + 1 }, (_, i) => `${inserts.get(i) || ''}${lyric.text[i] || ''}`).join('');
}

function renderGeometry(lines) {
  const output = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const chordline = geometryChords(line);
    if (i && lines[i - 1].y - line.y > line.size * 2.2) output.push('');
    if (chordline) {
      const next = lines[i + 1];
      if (next && !geometryChords(next) && !isSection(next.text) && line.y - next.y > 0 && line.y - next.y < Math.max(30, line.size * 2.7)) {
        output.push(alignLine(chordline, next)); i++;
      } else output.push(chordline.map(c => `[${c.chord}]`).join(' '));
    } else output.push(line.text);
  }
  return output.join('\n');
}

function identifyHeader(lines) {
  if (!lines.length) return null;
  const first = lines[0];
  if (geometryChords(first) || isSection(first.text) || first.text.length > 110) return null;
  const top = lines.slice(0, 10);
  const keyLine = top.findIndex(line => /\b(?:original\s+)?key\s*[:=]/i.test(line.text));
  const byLine = top.findIndex(line => /^(?:by|artist)\s*[:\-]?\s+/i.test(line.text));
  if (keyLine < 0 && byLine < 0) return null;
  const next = top[1]?.text || '';
  const artistIndex = byLine > 0 ? byLine : next && !/\b(?:key|bpm|tempo)\b/i.test(next) && !isSection(next) && !parseChordLine(next) ? 1 : -1;
  const artist = artistIndex >= 0 ? top[artistIndex].text.replace(/^(?:by|artist)\s*[:\-]?\s*/i, '') : '';
  let end = Math.max(0, artistIndex, keyLine);
  while (end + 1 < top.length && /^(?:bpm|tempo|time signature|original key)\s*[:=]/i.test(top[end + 1].text)) end++;
  const metadata = top.slice(0, end + 1).map(line => line.text).join(' ');
  const key = metadata.match(/\bkey\s*[:=]\s*([A-G][#b]?(?:m\b)?)/i)?.[1] || '';
  const bpm = Number(metadata.match(/\b(?:bpm|tempo)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)?.[1] || metadata.match(/\|\s*(\d{2,3})\s*\|/)?.[1]) || null;
  return { title: first.text.replace(/^(?:title|song)\s*:\s*/i, ''), artist, key, bpm, end };
}

/** Testable layout extraction; pages contain PDF.js text items and page dimensions. */
export function extractPdfPages(pages) {
  const candidates = []; const warnings = []; const sourceParts = [];
  let current = null;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const items = page.items.filter(item => clean(item.str)).map(item => ({ ...item, str: item.str.replace(/\u0000/g, ''), x: item.transform?.[4] ?? item.x ?? 0, y: item.transform?.[5] ?? item.y ?? 0, size: Math.abs(item.transform?.[3] || item.height || item.size || 10) }));
    if (!items.length) { warnings.push(`Page ${pageIndex + 1} contains no readable text. Scanned pages need OCR or manual entry.`); continue; }
    const middle = page.width / 2;
    // A real second column has multiple independently positioned runs. A full-width
    // sentence crossing the middle stays in its original column.
    const rightItems = items.filter(item => item.x >= middle);
    const twoColumns = rightItems.length >= 6 && items.filter(item => item.x < middle).length >= 6;
    const columns = twoColumns ? [items.filter(item => item.x < middle), rightItems] : [items];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const lines = columnLines(columns[columnIndex]);
      const raw = `[Page ${pageIndex + 1}${twoColumns ? `, ${columnIndex ? 'right' : 'left'} column` : ''}]\n${lines.map(line => line.text).join('\n')}`;
      sourceParts.push(raw);
      const header = columnIndex === 0 ? identifyHeader(lines) : null;
      if (header) {
        if (current) candidates.push(finishCandidate(current));
        current = { ...header, body: [], raw: [], pages: [] };
      }
      if (!current) current = { title: '', artist: '', key: '', bpm: null, body: [], raw: [], pages: [] };
      current.body.push(renderGeometry(header ? lines.slice(header.end + 1) : lines));
      current.raw.push(raw); current.pages.push(pageIndex + 1);
    }
  }
  if (current) candidates.push(finishCandidate(current));
  if (!candidates.length) throw new Error('This PDF has no extractable text. Use a text PDF, paste authorized text, or run OCR first.');
  warnings.push('PDF chord positions are estimated from document coordinates. Review each song and compare the original sheet before saving.');
  return { candidates, sourceText: sourceParts.join('\n\n'), warnings };
}

function finishCandidate(candidate) {
  const parsed = parseSheet(`{title:${candidate.title}}\n{artist:${candidate.artist}}\n{key:${candidate.key}}\n${candidate.bpm ? `{tempo:${candidate.bpm}}\n` : ''}${candidate.body.join('\n\n')}`);
  parsed.originalSource = candidate.raw.join('\n\n');
  parsed.sourcePages = [...new Set(candidate.pages)];
  return parsed;
}

export async function extractFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose a file to import.');
  if (file.size > MAX_BYTES) throw new Error('Files must be 15 MB or smaller.');
  const extension = String(file.name || '').split('.').at(-1).toLowerCase();
  if (['txt', 'cho', 'crd', 'chopro', 'chordpro', 'pro'].includes(extension)) return parseImportText(await file.text());
  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise;
    try {
      if (doc.numPages > 80) throw new Error('Import PDFs with 80 pages or fewer. Split larger collections before importing.');
      const pages = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber); const viewport = page.getViewport({ scale: 1 });
        const text = await page.getTextContent();
        pages.push({ width: viewport.width, height: viewport.height, items: text.items.filter(item => typeof item.str === 'string') });
      }
      return extractPdfPages(pages);
    } finally { await doc.destroy(); }
  }
  if (extension === 'docx') {
    const module = await import('mammoth/mammoth.browser.js');
    const mammoth = module.default || module;
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const parsed = parseImportText(result.value);
    parsed.warnings.push('DOCX text import cannot guarantee visual chord alignment. Review and adjust every chord line.');
    parsed.warnings.push(...result.messages.map(message => message.message));
    return parsed;
  }
  throw new Error('Supported files: PDF, DOCX, TXT, and ChordPro (.cho, .crd, .chopro, .chordpro, .pro).');
}
