import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSongs, findDuplicates } from '../src/lib/search.js';
const songs = [
  {id:'1',title:'Christ Be Magnified',artist:'Cody Carnes',content:'{section:Verse 1}\n[G]From north to south and east to west\n[C]We sing a song',aliases:[],tags:['praise']},
  {id:'2',title:'Magpakailanman',artist:'Passion Generation',content:'[G]Panginoon salamat',aliases:[],tags:['Tagalog']},
  {id:'3',title:'A Different Song',artist:'Other Ministry',content:'[D]From north to south and east to west\nYour love is near',aliases:['All of Creation'],tags:['prayer']},
];

test('exact, incomplete and typo titles rank reliably', () => {
  for (const query of ['Christ Be Magnified', 'Christ Magnified', 'Chrst Magnified', 'Chrsit', 'christ be magnifed', 'Christ Cody', 'Cody Carnes']) assert.equal(searchSongs(songs, query)[0]?.song.id, '1', query);
  assert.equal(searchSongs(songs, 'Magpakailan')[0]?.song.id, '2');
});

test('lyric phrases show evidence while stripping chords', () => {
  const results = searchSongs(songs, 'From north to south');
  assert.equal(results.length, 2);
  assert.equal(results[0].reason, 'Lyric phrase');
  assert.ok(results[0].snippet.includes('From north to south'));
  assert.ok(!results[0].snippet.includes('[G]'));
  assert.equal(searchSongs(songs, 'All of Creation')[0]?.song.id, '3');
  assert.equal(searchSongs(songs, 'Tagalog')[0]?.song.id, '2');
});

test('unrelated query returns no fake result; cache tracks edits', () => {
  assert.equal(searchSongs(songs, 'nonsenseunrelated').length, 0);
  const editable = {title:'First',content:'initial lyrics'};
  assert.equal(searchSongs([editable], 'replacement').length, 0);
  editable.content = 'replacement lyrics';
  assert.equal(searchSongs([editable], 'replacement').length, 1);
});

test('duplicate warnings do not overwrite or identify the current record', () => {
  const original = JSON.stringify(songs);
  assert.equal(findDuplicates({title:'christ be magnified',artist:'Cody Carnes'}, songs)[0]?.song.id, '1');
  assert.equal(findDuplicates({title:'Christ Be Magnifed',artist:'Cody Carnes'}, songs)[0]?.song.id, '1');
  assert.equal(findDuplicates(songs[0], songs).length, 0);
  assert.equal(JSON.stringify(songs), original);
});
