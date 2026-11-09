import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { handleApi } from '../src/server/api.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrationDir = new URL('../drizzle/', import.meta.url);
  const migrations = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length, 'Generate database migrations before running API integration tests.');
  for (const migration of migrations) sqlite.exec(readFileSync(new URL(migration, migrationDir), 'utf8'));
  const wrap = (sql, values = []) => ({
    bind(...next) { return wrap(sql, next); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
  });
  const objects = new Map();
  const env = { DB: { prepare: wrap, async batch(items) { sqlite.exec('BEGIN'); try { const values = []; for (const item of items) values.push(await item.run()); sqlite.exec('COMMIT'); return values; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } },
    BUCKET: { async put(key, value) { objects.set(key, value); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(key) { objects.delete(key); } } };
  async function request(path, method = 'GET', data, who = 'owner') {
    const headers = { origin: 'https://songbook.test' };
    if (who) { headers['oai-authenticated-user-id'] = who; headers['oai-authenticated-user-email'] = `${who}@example.test`; }
    const init = { method, headers };
    if (data !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(data); }
    const response = await handleApi(new Request(`https://songbook.test/api/${path}`, init), env);
    return { status: response.status, data: await response.json() };
  }
  return { sqlite, env, request, objects };
}
const sample = (extra = {}) => ({ title: 'Test of enduring praise', artist: 'Ministry test', key: 'G', bpm: 90, content: '{section:Verse 1}\n[G]Together we sing our [D]song', originalSource: 'original pasted content', ...extra });

test('unauthenticated requests are denied and first member is admin, subsequent member viewer', async () => {
  const { request, sqlite } = fixture();
  assert.equal((await request('bootstrap', 'GET', undefined, null)).status, 401);
  const owner = await request('bootstrap');
  assert.equal(owner.status, 200); assert.equal(owner.data.user.role, 'admin');
  const viewer = await request('bootstrap', 'GET', undefined, 'singer');
  assert.equal(viewer.data.user.role, 'viewer'); assert.equal(viewer.data.members, undefined);
  assert.equal((await request('songs', 'POST', sample(), 'singer')).status, 403);
  assert.equal((await request('members', 'GET', undefined, 'singer')).status, 403);
  assert.equal((await request('backup', 'GET', undefined, 'singer')).status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM members WHERE role='admin'").get().n, 1);
});

test('song and lineup persist, duplicates are detected, and stale writes never overwrite changes', async () => {
  const { request, sqlite } = fixture(); await request('bootstrap');
  const created = await request('songs', 'POST', sample());
  assert.equal(created.status, 201); const song = created.data.song;
  const refreshed = await request(`songs/${song.id}`);
  assert.equal(refreshed.data.song.content, sample().content);
  const duplicate = await request('songs', 'POST', sample());
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.code, 'DUPLICATE_SONG'); assert.ok(duplicate.data.duplicates.length);
  const edited = await request(`songs/${song.id}`, 'PUT', { ...song, notes: 'Church arrangement note' });
  assert.equal(edited.data.song.revision, 2);
  const stale = await request(`songs/${song.id}`, 'PUT', { ...song, notes: 'Stale edit' });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'REVISION_CONFLICT');
  assert.equal((await request(`songs/${song.id}`)).data.song.notes, 'Church arrangement note');
  const history = await request(`songs/${song.id}/history`);
  assert.equal(history.data.history[0].song.content, sample().content);
  const lineup = await request('lineups', 'POST', { title: 'Sunday worship', date: '2026-11-15', entries: [{ songId: song.id, key: 'Bb', notes: 'Quiet ending' }], status: 'draft' });
  assert.equal(lineup.status, 201);
  const saved = (await request(`lineups/${lineup.data.lineup.id}`)).data.lineup;
  assert.equal(saved.entries[0].songId, song.id); assert.equal(saved.entries[0].key, 'Bb');
  assert.throws(() => sqlite.prepare('DELETE FROM songs WHERE id=?').run(song.id), /FOREIGN KEY/);
  const updatedLineup = await request(`lineups/${saved.id}`, 'PUT', { ...saved, notes: 'Final rehearsal notes', entries: [{ ...saved.entries[0], key: 'A' }] });
  assert.equal(updatedLineup.data.lineup.revision, 2);
  const staleLineup = await request(`lineups/${saved.id}`, 'PUT', { ...saved, notes: 'Stale rehearsal', entries: [] });
  assert.equal(staleLineup.status, 409);
  assert.equal((await request(`lineups/${saved.id}`)).data.lineup.entries[0].key, 'A');
  const all = (await request('songs')).data.songs;
  assert.equal(all.filter(item => item.title === sample().title).length, 1);
  assert.equal((await request(`songs/${song.id}`, 'DELETE')).data.code, 'SONG_IN_USE');
});

test('validation rejects impossible service dates, missing references and unsafe requests', async () => {
  const { request, env } = fixture(); await request('bootstrap');
  assert.equal((await request('songs', 'POST', sample({ title: '' }))).status, 400);
  assert.equal((await request('songs', 'POST', sample({ bpm: 0 }))).status, 400);
  assert.equal((await request('songs', 'POST', sample({ arrangements: [null] }))).status, 400);
  assert.equal((await request('lineups', 'POST', { title: 'Invalid day', date: '2026-02-30', entries: [] })).status, 400);
  assert.equal((await request('lineups', 'POST', { title: 'Invalid entry', date: '2026-11-15', entries: [null] })).status, 400);
  assert.equal((await request('lineups', 'POST', { title: 'Missing song', date: '2026-11-15', entries: [{ songId: 'missing', key: 'G' }] })).status, 400);
  const response = await handleApi(new Request('https://songbook.test/api/songs', { method: 'POST', headers: { origin: 'https://hostile.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' }, body: JSON.stringify(sample()) }), env);
  assert.equal(response.status, 403);
});

test('roles are enforced server-side; favorites stay private to each member', async () => {
  const { request } = fixture(); await request('bootstrap');
  const song = (await request('songs', 'POST', sample())).data.song;
  await request('bootstrap', 'GET', undefined, 'singer');
  assert.equal((await request('members/singer', 'PUT', { role: 'editor' })).status, 200);
  assert.equal((await request('songs', 'POST', sample({ title: 'Different unique test', content: 'A fresh set of words entirely unrelated to prior verse' }), 'singer')).status, 201);
  assert.equal((await request('members/owner', 'PUT', { role: 'viewer' })).status, 409);
  assert.equal((await request('members/owner', 'PUT', { role: 'viewer' }, 'singer')).status, 403);
  await request(`favorites/${song.id}`, 'POST', { favorite: true }, 'singer');
  assert.deepEqual((await request('bootstrap', 'GET', undefined, 'singer')).data.favorites, [song.id]);
  assert.deepEqual((await request('bootstrap')).data.favorites, []);
});

test('alternate arrangements reuse a song record and cannot be removed while a service uses them', async () => {
  const { request } = fixture(); await request('bootstrap');
  const source = '  Original pasted text\nwith preserved spacing  \n';
  const song = (await request('songs', 'POST', sample({ originalSource: source }))).data.song;
  assert.equal(song.originalSource, source);
  const arranged = await request(`songs/${song.id}/arrangements`, 'POST', { revision: song.revision, name: 'Acoustic', key: 'A', content: '{section:Verse}\n[A]Acoustic words', originalSource: 'arrangement source' });
  assert.equal(arranged.status, 200); assert.equal(arranged.data.song.arrangements.length, 1);
  const updated = arranged.data.song, arrangement = updated.arrangements[0];
  const lineup = (await request('lineups', 'POST', { title: 'Acoustic service', date: '2026-11-15', entries: [{ songId: song.id, key: 'A', arrangementId: arrangement.id }] })).data.lineup;
  const removed = await request(`songs/${song.id}`, 'PUT', { ...updated, arrangements: [] });
  assert.equal(removed.status, 409); assert.equal(removed.data.code, 'ARRANGEMENT_IN_USE');
  await request(`lineups/${lineup.id}`, 'PUT', { ...lineup, entries: [{ ...lineup.entries[0], arrangementId: 'original', key: 'G' }] });
  assert.equal((await request(`songs/${song.id}`, 'PUT', { ...updated, arrangements: [] })).status, 200);
  assert.equal((await request('songs')).data.songs.filter(item => item.title === song.title).length, 1);
});

test('file uploads reject disguised PDFs and original bytes are authenticated', async () => {
  const { request, env } = fixture(); await request('bootstrap');
  const headers = { origin: 'https://songbook.test', 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' };
  const bad = new FormData(); bad.set('file', new File(['<script>bad</script>'], 'bad.pdf', { type: 'application/pdf' }));
  assert.equal((await handleApi(new Request('https://songbook.test/api/files', { method: 'POST', headers, body: bad }), env)).status, 415);
  const good = new FormData(); good.set('file', new File(['%PDF-1.7\nreference bytes'], 'rehearsal.pdf', { type: 'application/pdf' }));
  const uploaded = await handleApi(new Request('https://songbook.test/api/files', { method: 'POST', headers, body: good }), env);
  assert.equal(uploaded.status, 201); const file = (await uploaded.json()).file;
  assert.equal((await handleApi(new Request(`https://songbook.test${file.url}`), env)).status, 401);
  const loaded = await handleApi(new Request(`https://songbook.test${file.url}`, { headers }), env);
  assert.equal(loaded.status, 200); assert.match(await loaded.text(), /^%PDF-1.7/);
});

test('backup restore is additive and rejects dangling references atomically', async () => {
  const { request } = fixture(); await request('bootstrap');
  const song = (await request('songs', 'POST', sample())).data.song;
  const backup = (await request('backup')).data;
  assert.equal(backup.format, 'exalt-songbook-backup');
  const restored = await request('restore', 'POST', backup);
  assert.equal(restored.status, 200); assert.equal(restored.data.restoredSongs, 0);
  const invalid = { format: backup.format, version: 1, songs: [{ ...song, id: 'new-imported-id' }], lineups: [{ id: 'new-lineup-id', title: 'Broken backup', date: '2026-11-15', entries: [{ songId: 'absent', key: 'G' }] }] };
  assert.equal((await request('restore', 'POST', invalid)).status, 400);
  assert.equal((await request('songs/new-imported-id')).status, 404);
});
