import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, plainLyrics, transposeChord, transposeContent, chordSegments, chordWords, isChord } from '../src/lib/music.js';

test('pasted chords retain exact character anchors and real lyric words', () => {
  const source = 'Title: Test Song\nArtist: Ministry\nKey: G\nBPM: 72\n\nVerse 1\nG      D/F#      Em7\nA holy song of grace\n\nChorus\nCadd9     G/B\nSing to the Lord';
  const parsed = parseSheet(source);
  assert.equal(parsed.title, 'Test Song');
  assert.equal(parsed.artist, 'Ministry');
  assert.equal(parsed.key, 'G');
  assert.equal(parsed.bpm, 72);
  assert.ok(parsed.content.includes('[G]A holy [D/F#]song of gr[Em7]ace'));
  assert.equal(parsed.originalSource, source);
  assert.ok(plainLyrics(parsed.content).includes('A holy song of grace'));
  assert.ok(!plainLyrics(parsed.content).includes('D/F#'));
  assert.ok(plainLyrics(parsed.content).includes('Verse 1'));
});

test('ChordPro parsing preserves source and ordinary bracketed lyrics', () => {
  const parsed = parseSheet('{title: Home}\n{artist: Team}\n{key: Bb}\n{start_of_chorus}\n[Bb]A [Cm7]word [all sing]\n{end_of_chorus}');
  assert.equal(parsed.title, 'Home');
  assert.equal(parsed.key, 'Bb');
  assert.equal(plainLyrics(parsed.content), 'Chorus\nA word [all sing]');
  assert.deepEqual(chordSegments('Before [G]amazing [D/F#]grace'), [{chord:'',text:'Before '},{chord:'G',text:'amazing '},{chord:'D/F#',text:'grace'}]);
});

test('all common roots, slash bass, extensions and enharmonics transpose', () => {
  for (const chord of ['G', 'D', 'Em', 'Cadd9', 'F#m', 'Bb', 'Cm7', 'G/B', 'Bb/D', 'Gsus2', 'Dsus', 'Bm7', 'Cmaj7', 'A7(b9)', 'F#dim7']) assert.ok(isChord(chord), chord);
  assert.equal(transposeChord('G/B', 2), 'A/C#');
  assert.equal(transposeChord('Bb/D', 2, true), 'C/E');
  assert.equal(transposeChord('F#m7', -2), 'Em7');
  assert.equal(transposeChord('C7(b9)', 1, true), 'Db7(b9)');
  assert.equal(transposeContent('{section:Bridge}\n[G]Holy [D/F#]Lord [all sing]', 'G', 'Bb'), '{section:Bridge}\n[Bb]Holy [F/A]Lord [all sing]');
  assert.equal(transposeContent('[Bb]Same spelling', 'Bb', 'Bb'), '[Bb]Same spelling');
});

test('instrumental lines and repeat directions survive chord view without lyric pollution', () => {
  const parsed = parseSheet('Title: Instrumental\nIntro\n| G D | Em C |\nRepeat chorus x2\n[Chorus]\n[G]Glory');
  assert.ok(parsed.content.includes('[G]'));
  assert.ok(parsed.content.includes('{comment:Repeat chorus x2}'));
  assert.ok(!plainLyrics(parsed.content).includes('|'));
  assert.ok(plainLyrics(parsed.content).includes('Repeat chorus x2'));
});

test('missing content is flagged instead of generated', () => {
  const parsed = parseSheet('');
  assert.equal(parsed.content, '');
  assert.ok(parsed.warnings.length >= 1);
});

test('content-only conversion never consumes the first lyric as a song title or artist', () => {
  const parsed = parseSheet('A holy opening line\nG\nSing a song\n\nC    G\nOne more line', {contentOnly:true});
  assert.equal(parsed.title, '');
  assert.ok(parsed.content.startsWith('A holy opening line\n[G]Sing a song'));
  assert.ok(plainLyrics(parsed.content).includes('One more line'));
});

function chordAnchors(segments) {
  let position = 0;
  return segments.flatMap(segment => {
    const anchor = segment.chord ? [{ position, chord: segment.chord }] : [];
    position += segment.text.length;
    return anchor;
  });
}

test('responsive chord groups wrap whole words without changing syllable anchors', () => {
  const line = 'Were cre[G]ation suddenly ar[Cadd9]ticulate';
  const groups = chordWords(line);
  assert.deepEqual(groups.map(group => group.segments.map(segment => segment.text).join('')), ['Were ', 'creation ', 'suddenly ', 'articulate']);
  assert.deepEqual(groups[1].segments, [{chord:'',text:'cre'}, {chord:'G',text:'ation '}]);
  assert.deepEqual(chordAnchors(groups.flatMap(group => group.segments)), chordAnchors(chordSegments(line)));
});

test('responsive groups preserve all lyric characters and chords at whitespace and line edges', () => {
  for (const line of ['  [G]Holy   [C]Lord  ', 'With a [G]thousand tongues to lift one[Cadd9] cry', '[G][D]Sing[C]', 'Word [G] [D]next', 'Literal [all sing] text', '', '   ', '[G] [D] [Em7]', '[G][D]']) {
    const original = chordSegments(line);
    const groups = chordWords(line);
    const flattened = groups.flatMap(group => group.segments);
    assert.equal(flattened.map(segment => segment.text).join(''), original.map(segment => segment.text).join(''), line);
    assert.deepEqual(chordAnchors(flattened), chordAnchors(original), line);
  }
  const groups = chordWords('one[Cadd9] cry');
  assert.deepEqual(groups.map(group => group.segments.map(segment => segment.text).join('')), ['one', ' cry']);
  assert.equal(groups[1].segments[0].chord, 'Cadd9');
});
