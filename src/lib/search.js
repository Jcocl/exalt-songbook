import { plainLyrics } from './music.js';

export function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const listText = value => Array.isArray(value) ? value.join(' ') : String(value || '');
const cache = new WeakMap();

function documentFor(song) {
  const signature = [song.title, song.artist, song.content, song.lyrics, listText(song.aliases), listText(song.tags), song.notes].join('\0');
  const cached = cache.get(song);
  if (cached?.signature === signature) return cached;
  const lyrics = plainLyrics(song.content || song.lyrics || '');
  const fields = { title: normalizeText(song.title), aliases: normalizeText(listText(song.aliases)), artist: normalizeText(song.artist), lyrics: normalizeText(lyrics), tags: normalizeText(`${listText(song.tags)} ${song.language || ''} ${song.category || ''} ${song.notes || ''}`) };
  const result = { signature, lyrics, fields, tokens: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, [...new Set(value.split(' ').filter(Boolean))]])) };
  cache.set(song, result);
  return result;
}

function distance(a, b, maximum = Infinity) {
  if (Math.abs(a.length - b.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let previousPrevious = null;
  for (let i = 1; i <= a.length; i++) {
    const current = [i]; let minimum = i;
    for (let j = 1; j <= b.length; j++) {
      // Adjacent swaps count as one likely typing mistake.
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (previousPrevious && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previousPrevious[j - 2] + 1);
      current[j] = value; minimum = Math.min(minimum, value);
    }
    if (minimum > maximum) return maximum + 1;
    previousPrevious = previous; previous = current;
  }
  return previous[b.length];
}

function tokenStrength(query, token) {
  if (query === token) return 1;
  if (query.length >= 3 && token.startsWith(query)) return 0.9;
  if (query.length < 4) return 0;
  const maximum = query.length >= 8 ? 2 : 1;
  const delta = distance(query, token, maximum);
  return delta <= maximum ? 0.76 - delta * 0.08 : 0;
}

function excerpt(lyrics, queryTerms) {
  const lines = lyrics.split('\n').filter(line => line.trim());
  let best = ''; let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const joined = lines.slice(i, i + 2).join(' · ');
    const normalized = normalizeText(joined);
    const score = queryTerms.filter(term => normalized.includes(term)).length;
    if (score > bestScore) { bestScore = score; best = joined; }
  }
  return (best || lines.find(line => line.length > 18) || lines[0] || '').slice(0, 190);
}

/** All clues can contribute across title, artist and lyric fields. No AI/network needed. */
export function searchSongs(songs, query) {
  const normalized = normalizeText(query);
  if (!normalized) return songs.map(song => ({ song, score: 0, reason: '', snippet: '', matchedTerms: [] }));
  const terms = [...new Set(normalized.split(' '))].slice(0, 24);
  const results = [];
  // Across a large library many lyric words repeat. Compute a token's fuzzy
  // distance once per query rather than once per occurrence in every song.
  const tokenCaches = terms.map(() => new Map());
  const weights = { title: 100, aliases: 90, artist: 65, lyrics: 35, tags: 40 };
  for (const song of songs) {
    const doc = documentFor(song); let sum = 0; let matched = 0; const evidence = new Set();
    for (let termIndex = 0; termIndex < terms.length; termIndex++) {
      const term = terms[termIndex]; const tokenCache = tokenCaches[termIndex];
      let best = 0; let field = '';
      for (const [key, tokens] of Object.entries(doc.tokens)) {
        let strength = tokens.includes(term) ? 1 : 0;
        if (strength !== 1) for (const token of tokens) {
          let value = tokenCache.get(token);
          if (value === undefined) { value = tokenStrength(term, token); tokenCache.set(token, value); }
          strength = Math.max(strength, value); if (strength === 1) break;
        }
        if (strength * weights[key] > best) { best = strength * weights[key]; field = key; }
      }
      if (best) { matched++; sum += best; evidence.add(field); }
    }
    if (matched < terms.length) continue;
    let score = sum / terms.length; let reason = evidence.has('title') || evidence.has('aliases') ? 'Title match' : evidence.has('artist') ? 'Artist match' : evidence.has('lyrics') ? 'Lyrics match' : 'Tags & details';
    if (doc.fields.title === normalized) { score += 1000; reason = 'Exact title'; }
    else if (Array.isArray(song.aliases) && song.aliases.some(alias => normalizeText(alias) === normalized)) { score += 950; reason = 'Alternative title'; }
    else if (doc.fields.title.startsWith(normalized)) { score += 820; reason = 'Title match'; }
    else if (terms.every(term => doc.tokens.title.some(token => tokenStrength(term, token) === 1))) { score += 750; reason = 'Title match'; }
    else if (doc.fields.artist.includes(normalized)) { score += 700; reason = 'Artist match'; }
    else if (terms.length >= 2 && doc.fields.lyrics.includes(normalized)) { score += 790 + Math.min(terms.length, 8) * 8; reason = 'Lyric phrase'; }
    else if (terms.every(term => doc.tokens.title.some(token => tokenStrength(term, token) > 0))) { score += 610; reason = 'Similar title'; }
    else if (evidence.has('title') && evidence.has('artist')) { score += 650; reason = 'Title & artist'; }
    else score += evidence.has('lyrics') ? 280 : 350;
    results.push({ song, score: Math.round(score), reason, snippet: evidence.has('lyrics') || reason === 'Lyric phrase' ? excerpt(doc.lyrics, terms) : '', matchedTerms: terms });
  }
  return results.sort((a, b) => b.score - a.score || String(a.song.title).localeCompare(String(b.song.title)));
}

function jaccard(a, b) {
  const left = new Set(a.split(' ').filter(Boolean)); const right = new Set(b.split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  let common = 0; for (const word of left) if (right.has(word)) common++;
  return common / (left.size + right.size - common);
}

/** Returns warning candidates; callers must ask before overwriting any record. Scores 0–100. */
export function findDuplicates(candidate, songs) {
  const doc = documentFor(candidate);
  return songs.filter(song => !candidate.id || song.id !== candidate.id).map(song => {
    const other = documentFor(song); let score = 0; let reason = '';
    if (doc.fields.title && doc.fields.title === other.fields.title) { score = 100; reason = 'Same title'; }
    const aliases = [song.title, ...(Array.isArray(song.aliases) ? song.aliases : [])].map(normalizeText);
    if (doc.fields.title && aliases.includes(doc.fields.title)) { score = 100; reason = 'Same title or alternative title'; }
    if (doc.fields.title && other.fields.title) {
      const similarity = 1 - distance(doc.fields.title, other.fields.title) / Math.max(doc.fields.title.length, other.fields.title.length);
      if (similarity >= 0.78) {
        const sameArtist = doc.fields.artist && doc.fields.artist === other.fields.artist;
        const possible = Math.round(similarity * (sameArtist ? 100 : 86));
        if (possible > score) { score = possible; reason = sameArtist ? 'Similar title, same artist' : 'Similar title'; }
      }
    }
    if (doc.fields.lyrics.length > 60 && other.fields.lyrics.length > 60) {
      const similarity = jaccard(doc.fields.lyrics, other.fields.lyrics);
      if (similarity > 0.77 && similarity * 98 > score) { score = Math.round(similarity * 98); reason = 'Matching lyric content'; }
    }
    return { song, score, reason };
  }).filter(match => match.score >= 68).sort((a, b) => b.score - a.score);
}
