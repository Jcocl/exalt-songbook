/** Pure, loss-conscious helpers for ChordPro and pasted chord sheets. */
const CHORD = /^[A-G](?:#|b)?(?:(?:maj|min|dim|aug|sus|add|omit|no|m|M|ø|°|\+|-)?\d*(?:maj|min|dim|aug|sus|add|omit|no|m|M|ø|°|\+|-|[#b]?\d+|\([#b\d,+\-a-z]+\))*)?(?:\/[A-G](?:#|b)?)?$/;
const NOTES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SECTION = /^(?:intro|verse|pre[ -]?chorus|chorus|bridge|interlude|instrumental|turnaround|outro|ending|refrain|tag|vamp|coda|solo|breakdown|post[ -]?chorus)(?:\s*\d+)?(?:\s*\([^\n]*\))?$/i;
const INSTRUCTION = /^(?:repeat|back to|go to|all in|drums? in|build|break|stop|fade|rit\.?|ad lib|hold|pause|tacet|no chord|n\.c\.|x\s*\d+|\d+\s*x)(?:\b|\.).*/i;

export function isChord(value) {
  return typeof value === 'string' && CHORD.test(value.trim()) && value.trim().length <= 24;
}

/** Chord starts are measured in original characters; tabs use eight-column stops. */
export function parseChordLine(line) {
  const expanded = expandTabs(String(line));
  const tokens = [...expanded.matchAll(/\S+/g)];
  if (!tokens.length) return null;
  const chords = [];
  for (const token of tokens) {
    const value = token[0].replace(/^[|:]+|[|:]+$/g, '');
    if (!value || /^(?:[|:,\-–—]+|x\d+|\(\d+x\)|N\.C\.)$/i.test(value)) continue;
    if (!isChord(value)) return null;
    chords.push({ chord: value, position: token.index + token[0].indexOf(value) });
  }
  return chords.length ? chords : null;
}

function expandTabs(text) {
  let col = 0;
  return text.replace(/[^\n]|\n/g, char => {
    if (char === '\n') { col = 0; return char; }
    if (char === '\t') { const spaces = 8 - col % 8; col += spaces; return ' '.repeat(spaces); }
    col += 1;
    return char;
  });
}

function heading(line) {
  let text = line.trim().replace(/^\[([^\]]+)\]$/, '$1').replace(/:$/, '').trim();
  return SECTION.test(text) ? text : null;
}

function inlineChords(chords, lyric) {
  let line = expandTabs(lyric);
  const end = Math.max(line.length, ...chords.map(c => c.position));
  line = line.padEnd(end, ' ');
  for (let i = chords.length - 1; i >= 0; i--) {
    const { chord, position } = chords[i];
    line = `${line.slice(0, position)}[${chord}]${line.slice(position)}`;
  }
  return line.trimEnd();
}

/** Parse without silently inventing lyrics or discarding the source. */
export function parseSheet(source, options = {}) {
  const originalSource = String(source ?? '');
  const lines = originalSource.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const result = { title: '', artist: '', key: '', bpm: null, content: '', originalSource, warnings: [] };
  const body = [];
  let sawBody = false;
  const consumed = new Set();
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    const directive = text.match(/^\{\s*(title|t|artist|a|subtitle|st|key|k|tempo|bpm)\s*:\s*(.*?)\s*\}$/i);
    const metadata = text.match(/^(title|song|artist|by|key|original key|bpm|tempo)\s*:\s*(.+)$/i);
    const match = directive || metadata;
    if (match) {
      const field = match[1].toLowerCase(); const value = match[2].trim();
      if (['title', 't', 'song'].includes(field)) result.title = value;
      else if (['artist', 'a', 'by', 'subtitle', 'st'].includes(field)) result.artist = value;
      else if (['key', 'k', 'original key'].includes(field)) result.key = value.replace(/^key\s*/i, '').match(/^[A-G][#b]?(?:m|minor)?/i)?.[0] || value;
      else result.bpm = Number(value.match(/\d+(?:\.\d+)?/)?.[0]) || null;
      consumed.add(i);
      continue;
    }
    if (!options.contentOnly && !sawBody && text && !heading(text) && !parseChordLine(text) && !text.startsWith('{') && !text.includes('[')) {
      if (!result.title) {
        // A compact "Title — Artist" header is common in copied sheets.
        const pair = text.match(/^(.+?)\s+(?:—|–|\s-\s)\s*(.+)$/);
        result.title = pair ? pair[1].trim() : text;
        if (pair) result.artist = pair[2].trim();
        consumed.add(i);
        continue;
      }
      if (!result.artist && /^(?:by\s+|artist\s+)/i.test(text)) { result.artist = text.replace(/^(?:by|artist)\s+/i, ''); consumed.add(i); continue; }
      if (!result.artist && i < 4 && lines.slice(i + 1).some(line => heading(line) || parseChordLine(line))) {
        result.artist = text;
        consumed.add(i);
        continue;
      }
    }
    if (heading(text) || parseChordLine(text) || /\[[A-G]/.test(text) || (text && result.title)) sawBody = true;
  }
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const line = lines[i]; const text = line.trim();
    const section = heading(text);
    if (section) { body.push(`{section:${section}}`); continue; }
    if (/^\{\s*(?:start_of_|s[ocv]\b)/i.test(text)) {
      const type = /chorus|soc/i.test(text) ? 'Chorus' : /verse|sov/i.test(text) ? 'Verse' : 'Section';
      body.push(`{section:${text.match(/:\s*([^}]+)/)?.[1] || type}}`); continue;
    }
    if (/^\{\s*(?:end_of_|e[ocv]\b)/i.test(text)) { body.push(''); continue; }
    const chords = parseChordLine(line);
    if (chords && !text.includes('[')) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !consumed.has(i + 1) && !heading(next) && !parseChordLine(next) && !next.trim().startsWith('{') && !INSTRUCTION.test(next.trim())) {
        body.push(inlineChords(chords, next)); i += 1;
      } else body.push(line.replace(/\b[A-G](?:#|b)?[^\s|:]*/g, chord => isChord(chord) ? `[${chord}]` : chord).trimEnd());
      continue;
    }
    if (INSTRUCTION.test(text) && !text.startsWith('{')) body.push(`{comment:${text}}`);
    else body.push(line.trimEnd());
  }
  result.content = body.join('\n').replace(/^\n+|\n+$/g, '');
  if (!result.title && !options.contentOnly) result.warnings.push('No title was detected. Enter a title before saving.');
  if (!result.content.trim()) result.warnings.push('No song content was detected. Review the original source.');
  return result;
}

/** Splitting is intentionally explicit: ChordPro title directives are safe boundaries. */
export function splitSheets(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const chunks = normalized.split(/(?=^\{\s*(?:title|t)\s*:)/im).filter(t => t.trim());
  return chunks.map(parseSheet);
}

/** Each chunk keeps the chord anchored to its following syllable. */
export function chordSegments(line) {
  const result = []; let last = 0; let current = '';
  for (const match of String(line).matchAll(/\[([^\]\n]+)\]/g)) {
    if (!isChord(match[1])) continue;
    const text = line.slice(last, match.index);
    if (text || current) result.push({ chord: current, text });
    current = match[1]; last = match.index + match[0].length;
  }
  const text = String(line).slice(last);
  if (text || current || !result.length) result.push({ chord: current, text });
  return result;
}

/**
 * Wrap complete lyric words, keeping chord annotations at their exact character
 * anchors. A chord in the space before a word travels with that following word.
 */
export function chordWords(line) {
  const segments = chordSegments(String(line ?? ''));
  const text = segments.map(segment => segment.text).join('');
  const annotations = [];
  let position = 0;
  for (const segment of segments) {
    if (segment.chord) annotations.push({ position, chord: segment.chord });
    position += segment.text.length;
  }
  const words = [...text.matchAll(/\S+/g)];
  // Instrumentals have no lyric words; each existing chord remains wrappable.
  if (!words.length) return segments.map(segment => ({ segments: [segment] }));

  const groups = [];
  let start = 0;
  let annotationIndex = 0;
  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const word = words[wordIndex];
    let end = words[wordIndex + 1]?.index ?? text.length;
    if (wordIndex + 1 < words.length) {
      const wordEnd = word.index + word[0].length;
      const spaceChord = annotations.find(annotation => annotation.position >= wordEnd && annotation.position < end);
      if (spaceChord) end = spaceChord.position;
    }
    const parts = [];
    let cursor = start;
    let chord = '';
    while (annotationIndex < annotations.length && annotations[annotationIndex].position < end) {
      const annotation = annotations[annotationIndex++];
      const part = text.slice(cursor, annotation.position);
      if (part || chord) parts.push({ chord, text: part });
      chord = annotation.chord;
      cursor = annotation.position;
    }
    const tail = text.slice(cursor, end);
    if (tail || chord || !parts.length) parts.push({ chord, text: tail });
    groups.push({ segments: parts });
    start = end;
  }
  // A chord after the last lyric character has its own visible group.
  if (annotationIndex < annotations.length) {
    groups.push({ segments: annotations.slice(annotationIndex).map(annotation => ({ chord: annotation.chord, text: '' })) });
  }
  return groups;
}

export function plainLyrics(content) {
  return String(content ?? '').split(/\r?\n/).map(line => {
    const directive = line.trim().match(/^\{\s*([^:}]+)(?::\s*(.*?))?\s*\}$/);
    if (directive) {
      const name = directive[1].toLowerCase();
      if (['section', 'comment', 'c', 'comment_italic', 'comment_box'].includes(name)) return directive[2] || '';
      if (/^(?:start_of_chorus|soc)$/.test(name)) return directive[2] || 'Chorus';
      if (/^(?:start_of_verse|sov)$/.test(name)) return directive[2] || 'Verse';
      if (/^(?:end_of_|eoc|eov|title|artist|key|tempo|bpm|t$|a$|k$)/.test(name)) return '';
      return line;
    }
    const clean = line.replace(/\[([^\]\n]+)\]/g, (all, value) => isChord(value) ? '' : all);
    // A chord-only bar contributes no lyric words; preserve every other line.
    return clean.replace(/[|:]+/g, '').trim() ? clean : '';
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function semitoneDistance(fromKey, toKey) {
  const from = String(fromKey || '').match(/^[A-G](?:#|b)?/)?.[0];
  const to = String(toKey || '').match(/^[A-G](?:#|b)?/)?.[0];
  return from in NOTES && to in NOTES ? (NOTES[to] - NOTES[from] + 12) % 12 : 0;
}

export function transposeChord(chord, semitones, preferFlats = false) {
  if (!isChord(chord) || !Number.isFinite(Number(semitones))) return chord;
  const scale = preferFlats ? FLAT : SHARP;
  const shift = note => scale[((NOTES[note] + Number(semitones)) % 12 + 12) % 12];
  return chord.replace(/^([A-G](?:#|b)?)/, (_, note) => shift(note)).replace(/\/([A-G](?:#|b)?)$/, (_, note) => `/${shift(note)}`);
}

export function transposeContent(content, fromKey, toKey) {
  const distance = semitoneDistance(fromKey, toKey);
  const preferFlats = /b/.test(toKey || '') || ['F', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'].includes(toKey);
  if (distance === 0) return String(content ?? '');
  return String(content ?? '').replace(/\[([^\]\n]+)\]/g, (all, chord) => isChord(chord) ? `[${transposeChord(chord, distance, preferFlats)}]` : all);
}
