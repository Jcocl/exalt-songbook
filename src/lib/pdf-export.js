import { plainLyrics, transposeContent, chordWords } from './music.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 52;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// Normalize Unicode punctuation into WinAnsi-safe ASCII/Latin-1 characters for standard PDF Type1 fonts
function normalizePdfText(str) {
  return String(str || '')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '|')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, '');
}

function escapePdfString(str) {
  const clean = normalizePdfText(str);
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out += '\\' + clean[i];
    } else if (code > 126) {
      out += '\\' + code.toString(8).padStart(3, '0');
    } else {
      out += clean[i];
    }
  }
  return out;
}

// Approximate Helvetica character width in em units (1000 units = 1 em)
function charWidthEm(ch, bold = false) {
  if (ch === ' ') return 278;
  if ("iIlj|!.,:;'`".includes(ch)) return bold ? 290 : 250;
  if ('ftrt()-[]"'.includes(ch)) return bold ? 360 : 333;
  if ('mwMW@#%&'.includes(ch)) return bold ? 860 : 815;
  if (ch >= 'A' && ch <= 'Z') return bold ? 700 : 667;
  return bold ? 580 : 535;
}

function measureText(str, fontSize, bold = false) {
  const clean = normalizePdfText(str);
  let total = 0;
  for (let i = 0; i < clean.length; i++) {
    total += charWidthEm(clean[i], bold);
  }
  return (total / 1000) * fontSize;
}

function wrapText(text, fontSize, maxWidth, bold = false) {
  const clean = normalizePdfText(text);
  if (!clean.trim()) return [''];
  const words = clean.split(/(\s+)/);
  const lines = [];
  let current = '';
  for (const part of words) {
    const candidate = current + part;
    if (current && measureText(candidate, fontSize, bold) > maxWidth) {
      lines.push(current.trimEnd());
      current = part.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines.length ? lines : [''];
}

/**
 * Generates a vector PDF byte array (Uint8Array) for one or more songs.
 * @param {Array<{song: object, key?: string, baseKey?: string, content?: string}>} items
 * @param {'chords'|'lyrics'} mode
 * @returns {Uint8Array}
 */
export function buildSongsPdf(items = [], mode = 'chords') {
  const pages = [];
  let currentOps = [];
  let y = PAGE_H - MARGIN_TOP;

  function startPage() {
    currentOps = [];
    pages.push(currentOps);
    y = PAGE_H - MARGIN_TOP;
  }

  function ensureSpace(heightNeeded) {
    if (y - heightNeeded < MARGIN_BOTTOM) {
      startPage();
    }
  }

  function drawText(text, x, yPos, { font = 'F1', size = 11, color = [0.129, 0.169, 0.165] } = {}) {
    const escaped = escapePdfString(text);
    if (!escaped) return;
    const [r, g, b] = color;
    currentOps.push(
      `BT /${font} ${size.toFixed(2)} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x.toFixed(2)} ${yPos.toFixed(2)} Td (${escaped}) Tj ET`
    );
  }

  function drawRule(yPos) {
    currentOps.push(
      `0.820 0.788 0.737 RG 0.75 w ${MARGIN_X.toFixed(2)} ${yPos.toFixed(2)} m ${(PAGE_W - MARGIN_X).toFixed(2)} ${yPos.toFixed(2)} l S`
    );
  }

  for (let songIdx = 0; songIdx < items.length; songIdx++) {
    const it = items[songIdx];
    const song = it?.song;
    if (!song) continue;

    startPage();

    const baseKey = it.baseKey || song.key || 'C';
    const targetKey = it.key || song.key || 'C';
    const rawContent = it.content || song.content || '';
    const transposed = transposeContent(rawContent, baseKey, targetKey);

    // Eyebrow
    drawText('EXALT SONGBOOK / CCF TARLAC', MARGIN_X, y, {
      font: 'F2',
      size: 8.5,
      color: [0.408, 0.408, 0.373],
    });
    y -= 24;

    // Song Title
    const titleLines = wrapText(song.title || 'Untitled Song', 21, CONTENT_W, true);
    for (const tLine of titleLines) {
      ensureSpace(24);
      drawText(tLine, MARGIN_X, y, {
        font: 'F2',
        size: 21,
        color: [0.129, 0.169, 0.165],
      });
      y -= 24;
    }

    // Meta line (Artist, Key, BPM)
    const metaParts = [];
    if (song.artist) metaParts.push(song.artist);
    metaParts.push(`Key: ${targetKey}`);
    if (song.bpm) metaParts.push(`${song.bpm} BPM`);
    drawText(metaParts.join('  |  '), MARGIN_X, y + 4, {
      font: 'F1',
      size: 10.5,
      color: [0.408, 0.408, 0.373],
    });
    y -= 10;

    drawRule(y);
    y -= 20;

    // Render sheet lines
    const lines = String(transposed || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const directive = line.match(/^\{([^:}]+):?\s*(.*?)\}$/);
      if (directive) {
        const tag = directive[1].toLowerCase();
        if (['title', 't', 'artist', 'subtitle', 'key', 'tempo', 'bpm'].includes(tag)) continue;
        const label = directive[2] || directive[1].replaceAll('_', ' ');
        if (/comment|c$/.test(tag)) {
          ensureSpace(18);
          drawText(label, MARGIN_X, y, {
            font: 'F3',
            size: 9.5,
            color: [0.408, 0.408, 0.373],
          });
          y -= 15;
        } else {
          y -= 6;
          ensureSpace(24);
          drawText(label.toUpperCase(), MARGIN_X, y, {
            font: 'F2',
            size: 9.5,
            color: [0.49, 0.349, 0.263],
          });
          y -= 15;
        }
        continue;
      }

      if (!line.trim()) {
        y -= 9;
        continue;
      }

      if (mode === 'lyrics') {
        const lyric = plainLyrics(line);
        if (!lyric.trim()) continue;
        const wrapped = wrapText(lyric, 11.5, CONTENT_W, false);
        for (const wLine of wrapped) {
          ensureSpace(18);
          drawText(wLine, MARGIN_X, y, {
            font: 'F1',
            size: 11.5,
            color: [0.129, 0.169, 0.165],
          });
          y -= 17;
        }
        continue;
      }

      // Chords mode
      const words = chordWords(line);
      const isInstrumental = !plainLyrics(line).trim();
      const hasAnyChord = words.some(w => w.segments.some(s => s.chord));

      if (isInstrumental) {
        ensureSpace(20);
        let x = MARGIN_X;
        for (const word of words) {
          for (const seg of word.segments) {
            if (!seg.chord) continue;
            const cWidth = measureText(seg.chord + '   ', 10.5, true);
            if (x + cWidth > PAGE_W - MARGIN_X && x > MARGIN_X) {
              y -= 18;
              ensureSpace(20);
              x = MARGIN_X;
            }
            drawText(seg.chord, x, y, {
              font: 'F2',
              size: 10.5,
              color: [0.749, 0.271, 0.141],
            });
            x += cWidth;
          }
        }
        y -= 18;
        continue;
      }

      const rowHeight = hasAnyChord ? 29 : 17;
      ensureSpace(rowHeight);
      if (hasAnyChord) y -= 11; // reserve space above baseline for chords

      let x = MARGIN_X;
      for (const word of words) {
        // Compute total width of this word
        const segWidths = word.segments.map(s => {
          const cw = s.chord ? measureText(s.chord + '  ', 10, true) : 0;
          const tw = measureText(s.text || '', 11, false);
          return Math.max(cw, tw);
        });
        const wordWidth = segWidths.reduce((a, b) => a + b, 0);

        if (x + wordWidth > PAGE_W - MARGIN_X && x > MARGIN_X) {
          y -= rowHeight;
          ensureSpace(rowHeight);
          x = MARGIN_X;
        }

        for (let sIdx = 0; sIdx < word.segments.length; sIdx++) {
          const seg = word.segments[sIdx];
          const w = segWidths[sIdx];
          if (seg.chord) {
            drawText(seg.chord, x, y + 11.5, {
              font: 'F2',
              size: 10,
              color: [0.749, 0.271, 0.141],
            });
          }
          if (seg.text) {
            drawText(seg.text, x, y, {
              font: 'F1',
              size: 11,
              color: [0.129, 0.169, 0.165],
            });
          }
          x += w;
        }
      }
      y -= 17;
    }

    if (song.source) {
      y -= 10;
      ensureSpace(16);
      drawText(song.source, MARGIN_X, y, {
        font: 'F1',
        size: 8.5,
        color: [0.45, 0.45, 0.42],
      });
    }
  }

  if (!pages.length) startPage();

  // Assemble PDF objects
  // Object 1: Catalog
  // Object 2: Pages
  // Object 3: Font F1 (Helvetica)
  // Object 4: Font F2 (Helvetica-Bold)
  // Object 5: Font F3 (Helvetica-Oblique)
  // Objects 6..: Page and Content stream pairs
  const objects = [];
  const pageObjNums = [];

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push(''); // placeholder for 2 0 obj (Pages)
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj');
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj');

  for (let p = 0; p < pages.length; p++) {
    const pageObjNum = objects.length + 1;
    const contentObjNum = objects.length + 2;
    pageObjNums.push(pageObjNum);

    const streamBody = pages[p].join('\n');
    const pageDict =
      `${pageObjNum} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
      `/Contents ${contentObjNum} 0 R >>\n` +
      `endobj`;
    const contentStream =
      `${contentObjNum} 0 obj\n` +
      `<< /Length ${streamBody.length} >>\n` +
      `stream\n${streamBody}\nendstream\n` +
      `endobj`;

    objects.push(pageDict);
    objects.push(contentStream);
  }

  objects[1] =
    `2 0 obj\n` +
    `<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>\n` +
    `endobj`;

  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;

  function pushStr(s) {
    const bytes = encoder.encode(s);
    chunks.push(bytes);
    offset += bytes.length;
  }

  pushStr('%PDF-1.4\n');
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(offset);
    pushStr(obj + '\n');
  }

  const xrefOffset = offset;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const output = new Uint8Array(offset);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  return output;
}

export function downloadSongsPdf(items, mode = 'chords', title = 'Song') {
  const bytes = buildSongsPdf(items, mode);
  const safeName =
    String(title || 'Song')
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '')
      .trim() || 'Song';
  const suffix = mode === 'lyrics' ? ' (Lyrics)' : '';
  const filename = `${safeName}${suffix}.pdf`;
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
