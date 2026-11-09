import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { extractFile, extractPdfPages, parseImportText } from '../src/lib/importer.js';
import { plainLyrics } from '../src/lib/music.js';

test('supplied five-page PDF separates four songs and retains continuation', async () => {
  const bytes = await fs.readFile(new URL('../public/reference-lineup.pdf', import.meta.url));
  const result = await extractFile({name:'lineup.pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
  assert.deepEqual(result.candidates.map(candidate => candidate.title.toLowerCase()), ['praise yahweh','magpakailanman','all of creation (even so come)','christ be magnified']);
  assert.deepEqual(result.candidates[3].sourcePages, [4,5]);
  assert.equal(result.candidates[1].bpm, 138);
  assert.equal(result.candidates[3].bpm, 72);
  assert.ok(result.candidates.every(candidate => candidate.content.includes('{section:')));
  assert.ok(result.candidates[0].content.includes('[Bb]'));
  assert.ok(!result.candidates[1].content.includes('[Ve['));
  assert.ok(result.candidates[1].content.includes('{section:Verse 1}'));
  assert.ok(plainLyrics(result.candidates[3].content).includes('resurrection life'));
  assert.ok(result.candidates.every(candidate => candidate.originalSource.includes('[Page')));
  assert.ok(result.warnings.some(warning => warning.includes('Review')));
});

test('scanned empty PDFs are rejected with a useful OCR message', () => {
  assert.throws(() => extractPdfPages([{width:600,height:800,items:[]}]), /OCR/);
});

test('files are bounded and unknown formats rejected', async () => {
  await assert.rejects(() => extractFile({name:'a.pdf',size:16*1024*1024,arrayBuffer(){}}), /15 MB/);
  await assert.rejects(() => extractFile({name:'a.exe',size:1,arrayBuffer(){}}), /Supported files/);
});

test('ChordPro multi-song import splits explicit title boundaries', () => {
  const result = parseImportText('{title:First}\n[G]One\n{title:Second}\n[C]Two');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[1].title, 'Second');
});
