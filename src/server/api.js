import reference from '../data/reference-songs.json' with { type: 'json' };
import { findDuplicates } from '../lib/search.js';
import { plainLyrics } from '../lib/music.js';

const MAX_JSON = 2_000_000;
const MAX_UPLOAD = 15 * 1024 * 1024;
const KEYS = /^(?:[A-G](?:#|b)?m?)?$/;
const ROLES = new Set(['admin', 'editor', 'viewer']);
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
class ApiError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR', extra = {}) {
    super(message); this.status = status; this.code = code; this.extra = extra;
  }
}
const fail = (status, message, code, extra) => { throw new ApiError(status, message, code, extra); };
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const changes = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);
const statement = (db, sql, ...values) => { const prepared = db.prepare(sql); return values.length ? prepared.bind(...values) : prepared; };
const rows = async (db, sql, ...values) => (await statement(db, sql, ...values).all()).results ?? [];
const first = (db, sql, ...values) => statement(db, sql, ...values).first();

function field(value, label, max, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string') fail(400, `${label} must be text.`, 'VALIDATION');
  if (value.length > max) fail(400, `${label} is too long (maximum ${max} characters).`, 'VALIDATION');
  const result = value.trim();
  if (required && !result) fail(400, `${label} is required.`, 'VALIDATION');
  return result;
}
function rawField(value, label, max, required = false) {
  field(value, label, max, required);
  return value ?? '';
}
function textArray(value, label) {
  if (value == null) return [];
  if (typeof value === 'string') value = value.split(',');
  if (!Array.isArray(value) || value.length > 40) fail(400, `${label} must contain at most 40 items.`, 'VALIDATION');
  return [...new Set(value.map(item => field(item, label, 160)).filter(Boolean))];
}
function keyField(value) {
  const key = field(value, 'Key', 4);
  if (!KEYS.test(key)) fail(400, 'Choose a musical key such as G, F#m or Bb.', 'VALIDATION');
  return key;
}
function objectItem(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `${label} must be an object.`, 'VALIDATION');
  return value;
}
function arrangementsField(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) fail(400, 'A song can have up to 30 arrangements.', 'VALIDATION');
  const arrangements = value.map(input => { const item = objectItem(input, 'Arrangement'); return ({
    id: field(item.id, 'Arrangement ID', 100) || uid(),
    name: field(item.name, 'Arrangement name', 160, true),
    key: keyField(item.key), content: rawField(item.content, 'Arrangement content', 200_000, true),
    notes: field(item.notes, 'Arrangement notes', 5000),
    originalSource: rawField(item.originalSource, 'Original arrangement source', 400_000),
    source: field(item.source, 'Arrangement attribution', 1500),
    attachmentId: field(item.attachmentId, 'Arrangement attachment ID', 120),
  }); });
  if (new Set(arrangements.map(item => item.id)).size !== arrangements.length) fail(400, 'Each arrangement must have its own ID.', 'VALIDATION');
  return arrangements;
}
export function validateSong(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Enter a song to save.', 'VALIDATION');
  let bpm = body.bpm === '' || body.bpm == null ? null : Number(body.bpm);
  if (bpm !== null && (!Number.isFinite(bpm) || bpm < 20 || bpm > 400)) fail(400, 'Tempo must be between 20 and 400 BPM.', 'VALIDATION');
  return {
    title: field(body.title, 'Song title', 250, true), artist: field(body.artist, 'Artist', 250),
    key: keyField(body.key), bpm, language: field(body.language, 'Language', 80) || 'English',
    content: rawField(body.content, 'Song content', 200_000, true),
    originalSource: rawField(body.originalSource, 'Original source', 400_000),
    source: field(body.source, 'Attribution / source', 1500), notes: field(body.notes, 'Notes', 10_000),
    aliases: textArray(body.aliases, 'Alternative titles'), tags: textArray(body.tags, 'Tags'),
    arrangements: arrangementsField(body.arrangements),
    attachmentId: field(body.attachmentId, 'Attachment ID', 120),
    needsReview: Boolean(body.needsReview),
  };
}
export function validateLineup(body) {
  if (!body || typeof body !== 'object') fail(400, 'Enter a lineup to save.', 'VALIDATION');
  const date = field(body.date, 'Service date', 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail(400, 'Choose a valid service date.', 'VALIDATION');
  const status = body.status || 'draft';
  if (!['draft', 'finalized'].includes(status)) fail(400, 'Choose Draft or Finalized.', 'VALIDATION');
  if (!Array.isArray(body.entries) || body.entries.length > 60) fail(400, 'A lineup must contain a song list (up to 60 entries).', 'VALIDATION');
  const lineup = {
    title: field(body.title, 'Service name', 250, true), date, status,
    notes: field(body.notes, 'Service notes', 10_000),
    entries: body.entries.map(input => { const item = objectItem(input, 'Lineup entry'); return ({
      id: field(item.id, 'Entry ID', 100) || uid(), songId: field(item.songId, 'Song', 120, true),
      key: keyField(item.key), arrangementId: field(item.arrangementId, 'Arrangement ID', 100),
      notes: field(item.notes, 'Song notes', 5000),
    }); }),
  };
  if (new Set(lineup.entries.map(item => item.id)).size !== lineup.entries.length) fail(400, 'Each lineup entry must have its own ID.', 'VALIDATION');
  return lineup;
}
function songFromRow(row) {
  if (!row) return null;
  return { ...JSON.parse(row.data), id: row.id, title: row.title, artist: row.artist, content: row.content,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by };
}
function lineupFromRow(row) {
  if (!row) return null;
  return { ...JSON.parse(row.data), id: row.id, date: row.date, title: row.title,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by };
}
const allSongs = async db => (await rows(db, 'SELECT * FROM songs ORDER BY title COLLATE NOCASE')).map(songFromRow);
const allLineups = async db => (await rows(db, 'SELECT * FROM lineups ORDER BY date DESC, created_at DESC')).map(lineupFromRow);
const searchText = song => [song.title, song.artist, ...song.aliases, ...song.tags, plainLyrics(song.content)].join(' ').normalize('NFKD').toLowerCase();

function songInsert(db, id, song, userId, time, ignore = false) {
  return statement(db, `INSERT ${ignore ? 'OR IGNORE ' : ''}INTO songs (id,title,artist,content,search_text,data,revision,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,1,?,?,?)`,
    id, song.title, song.artist, song.content, searchText(song), JSON.stringify(song), time, time, userId);
}
function lineupInsert(db, id, lineup, userId, time, ignore = false) {
  return statement(db, `INSERT ${ignore ? 'OR IGNORE ' : ''}INTO lineups (id,date,title,data,revision,created_at,updated_at,updated_by) VALUES (?,?,?,?,1,?,?,?)`,
    id, lineup.date, lineup.title, JSON.stringify(lineup), time, time, userId);
}
function lineupRefStatements(db, id, entries, revision) {
  return [...new Set(entries.map(entry => entry.songId))].map(songId => revision == null
    ? statement(db, 'INSERT OR IGNORE INTO lineup_songs (id,lineup_id,song_id) VALUES (?,?,?)', `${id}:${songId}`, id, songId)
    : statement(db, 'INSERT INTO lineup_songs (id,lineup_id,song_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM lineups WHERE id=? AND revision=?)', `${id}:${songId}`, id, songId, id, revision));
}
async function seedReference(db) {
  if (await first(db, 'SELECT id FROM app_state WHERE id = ?', 'reference-seed-v1')) return;
  const time = now();
  const songs = (reference.songs || []).map(song => ({ id: song.id, ...validateSong(song) }));
  const inserts = songs.map(song => songInsert(db, song.id, song, 'reference-import', time, true));
  if (reference.lineup && songs.length) {
    const seed = reference.lineup;
    const lineup = validateLineup({ title: seed.title || 'Exalt Tarlac worship lineup', date: seed.date || '2026-11-07', status: seed.status || 'draft',
      notes: seed.notes || 'Imported from the supplied ministry PDF. Review chord placement against the original sheet.',
      entries: seed.entries || songs.map(song => ({ id: `reference-entry-${song.id}`, songId: song.id, key: song.key, notes: '' })) });
    inserts.push(lineupInsert(db, 'reference-lineup-2026-11-07', lineup, 'reference-import', time, true));
    inserts.push(...lineupRefStatements(db, 'reference-lineup-2026-11-07', lineup.entries));
  }
  if (inserts.length) {
    inserts.push(statement(db, 'INSERT OR IGNORE INTO app_state (id,value) VALUES (?,?)', 'reference-seed-v1', time));
    await db.batch(inserts);
  }
}
function parseSessionCookie(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'exalt_session' && v.length) {
      try {
        const parsed = JSON.parse(decodeURIComponent(v.join('=')));
        if (parsed?.id && parsed?.email) return parsed;
      } catch {}
    }
  }
  return null;
}
async function ensureMember(db, id, email, name) {
  await statement(db, "INSERT OR IGNORE INTO members (id,email,name,role,created_at) SELECT ?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM members) THEN 'admin' ELSE 'viewer' END,?", id, email, name.slice(0, 250), now()).run();
  const member = await first(db, 'SELECT * FROM members WHERE id = ?', id);
  return { id: member.id, email: member.email, name: member.name, role: member.role };
}
async function identity(request, db) {
  let id = request.headers.get('x-user-id') || request.headers.get('oai-authenticated-user-id');
  let email = request.headers.get('x-user-email') || request.headers.get('oai-authenticated-user-email');
  let name = request.headers.get('x-user-name') || request.headers.get('oai-authenticated-user-full-name');
  if (name && request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(name); } catch { name = ''; }
  }
  if (!id || !email) {
    const session = parseSessionCookie(request);
    if (session) { id = session.id; email = session.email; name = session.name; }
  }
  if (!id || !email) fail(401, 'Sign in to open the ministry songbook.', 'SIGN_IN_REQUIRED');
  return ensureMember(db, id, email, name || email.split('@')[0]);
}
function permission(user, role = 'editor') {
  if (role === 'admin' ? user.role !== 'admin' : !['admin', 'editor'].includes(user.role)) fail(403, role === 'admin' ? 'Only an administrator can do this.' : 'Ask an administrator for editing access.', 'FORBIDDEN');
}
async function limitedBytes(request, max) {
  const length = Number(request.headers.get('content-length'));
  if (length > max) fail(413, 'This request is too large.', 'PAYLOAD_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); fail(413, 'This request is too large.', 'PAYLOAD_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function bodyJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'Send this request as JSON.', 'CONTENT_TYPE');
  const text = new TextDecoder().decode(await limitedBytes(request, MAX_JSON));
  try { return JSON.parse(text); } catch { fail(400, 'The submitted data is not valid JSON.', 'INVALID_JSON'); }
}
function verifyOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) fail(403, 'This request came from another website.', 'ORIGIN_MISMATCH');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') fail(403, 'This request came from another website.', 'ORIGIN_MISMATCH');
}
async function validateRefs(db, lineup) {
  const songs = new Map((await allSongs(db)).map(song => [song.id, song]));
  for (const entry of lineup.entries) {
    const song = songs.get(entry.songId);
    if (!song) fail(400, 'One of the selected songs no longer exists. Refresh the library.', 'MISSING_SONG');
    if (entry.arrangementId && entry.arrangementId !== 'original' && !song.arrangements?.some(item => item.id === entry.arrangementId)) fail(400, `The selected arrangement for ${song.title} no longer exists.`, 'MISSING_ARRANGEMENT');
  }
}
async function attachmentExists(db, song) {
  for (const id of [song.attachmentId, ...(song.arrangements || []).map(item => item.attachmentId)].filter(Boolean)) {
    if (!await first(db, 'SELECT id FROM files WHERE id = ?', id)) fail(400, 'The original file is missing. Upload it again.', 'MISSING_FILE');
  }
}

async function api(request, env) {
  verifyOrigin(request);
  const db = env.DB;
  if (!db) fail(503, 'The songbook database is not connected yet.', 'DATABASE_UNAVAILABLE');
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(part => decodeURIComponent(part));
  const [resource, id, action] = parts;
  const method = request.method;

  if (resource === 'session' && method === 'POST') {
    const body = await bodyJson(request).catch(() => ({}));
    const email = field(body.email || 'worship@ccftarlac.local', 'Email', 160, true).toLowerCase();
    const name = field(body.name || email.split('@')[0], 'Name', 160, true);
    const memberId = 'member_' + email.replace(/[^a-z0-9]+/g, '_');
    const user = await ensureMember(db, memberId, email, name);
    const cookieVal = encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, name: user.name }));
    return Response.json({ user }, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Set-Cookie': `exalt_session=${cookieVal}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
      },
    });
  }
  if (resource === 'session' && method === 'DELETE') {
    return Response.json({ signedOut: true }, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Set-Cookie': 'exalt_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      },
    });
  }

  const user = await identity(request, db);

  if (resource === 'bootstrap' && method === 'GET') {
    await seedReference(db);
    const [songs, lineups, favoriteRows, memberRows] = await Promise.all([allSongs(db), allLineups(db), rows(db, 'SELECT song_id FROM favorites WHERE user_id = ?', user.id), user.role === 'admin' ? rows(db, 'SELECT * FROM members ORDER BY created_at') : Promise.resolve(undefined)]);
    return json({ user, songs, lineups, favorites: favoriteRows.map(row => row.song_id), ...(memberRows ? { members: memberRows } : {}) });
  }

  if (resource === 'songs' && !id && method === 'GET') return json({ songs: await allSongs(db) });
  if (resource === 'songs' && id && action === 'history' && method === 'GET') {
    const history = (await rows(db, 'SELECT * FROM history WHERE song_id = ? ORDER BY revision DESC LIMIT 100', id)).map(row => ({ ...row, song: JSON.parse(row.data), changedBy: row.changed_by, createdAt: row.created_at }));
    return json({ history });
  }
  if (resource === 'songs' && id && !action && method === 'GET') {
    const song = songFromRow(await first(db, 'SELECT * FROM songs WHERE id = ?', id));
    if (!song) fail(404, 'This song could not be found.', 'NOT_FOUND');
    return json({ song });
  }
  if (resource === 'songs' && !action && ['POST', 'PUT'].includes(method)) {
    permission(user);
    if ((method === 'POST' && id) || (method === 'PUT' && !id)) fail(404, 'This action could not be found.', 'NOT_FOUND');
    const body = await bodyJson(request), song = validateSong(body), time = now();
    await attachmentExists(db, song);
    const songs = await allSongs(db);
    if (method === 'POST') {
      const duplicates = findDuplicates(song, songs);
      if (duplicates.length && body.allowDuplicate !== true && body.forceSeparate !== true && body.forceDuplicate !== true) fail(409, 'This song may already exist in your library.', 'DUPLICATE_SONG', { duplicates });
      const songId = uid();
      await songInsert(db, songId, song, user.id, time).run();
      return json({ song: songFromRow(await first(db, 'SELECT * FROM songs WHERE id = ?', songId)) }, 201);
    }
    const old = songs.find(item => item.id === id);
    if (!old) fail(404, 'This song could not be found.', 'NOT_FOUND');
    if (body.revision !== old.revision) fail(409, 'This song was changed by someone else. Reload it before saving your changes.', 'REVISION_CONFLICT', { current: old });
    const arrangements = new Set(song.arrangements.map(item => item.id));
    const affected = (await allLineups(db)).filter(lineup => lineup.entries.some(entry => entry.songId === id && entry.arrangementId && entry.arrangementId !== 'original' && !arrangements.has(entry.arrangementId)));
    if (affected.length) fail(409, 'An arrangement you removed is used by a saved lineup. Choose another arrangement in those lineups first.', 'ARRANGEMENT_IN_USE', { lineups: affected.map(lineup => ({ id: lineup.id, title: lineup.title, date: lineup.date })) });
    const updates = await db.batch([
      statement(db, 'INSERT INTO history (id,song_id,data,revision,changed_by,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM songs WHERE id=? AND revision=?)', uid(), id, JSON.stringify(old), old.revision, user.id, time, id, body.revision),
      statement(db, 'UPDATE songs SET title=?,artist=?,content=?,search_text=?,data=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?', song.title, song.artist, song.content, searchText(song), JSON.stringify(song), time, user.id, id, body.revision),
    ]);
    if (!changes(updates[1])) fail(409, 'This song changed while you were editing. Reload and try again.', 'REVISION_CONFLICT');
    return json({ song: songFromRow(await first(db, 'SELECT * FROM songs WHERE id = ?', id)) });
  }
  if (resource === 'songs' && id && action === 'arrangements' && method === 'POST') {
    permission(user);
    const body = await bodyJson(request), old = songFromRow(await first(db, 'SELECT * FROM songs WHERE id = ?', id));
    if (!old) fail(404, 'This song could not be found.', 'NOT_FOUND');
    if (body.revision !== old.revision) fail(409, 'This song changed. Reload it before adding the arrangement.', 'REVISION_CONFLICT', { current: old });
    const arrangement = arrangementsField([body])[0];
    const song = validateSong({ ...old, arrangements: [...(old.arrangements || []), arrangement] });
    await attachmentExists(db, song);
    const time = now();
    const updates = await db.batch([
      statement(db, 'INSERT INTO history (id,song_id,data,revision,changed_by,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM songs WHERE id=? AND revision=?)', uid(), id, JSON.stringify(old), old.revision, user.id, time, id, old.revision),
      statement(db, 'UPDATE songs SET data=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?', JSON.stringify(song), time, user.id, id, old.revision),
    ]);
    if (!changes(updates[1])) fail(409, 'This song changed. Reload and try again.', 'REVISION_CONFLICT');
    return json({ song: songFromRow(await first(db, 'SELECT * FROM songs WHERE id = ?', id)) });
  }
  if (resource === 'songs' && id && method === 'DELETE') {
    permission(user);
    const song = songFromRow(await first(db, 'SELECT * FROM songs WHERE id = ?', id));
    if (!song) fail(404, 'This song could not be found.', 'NOT_FOUND');
    const used = (await allLineups(db)).filter(lineup => lineup.entries.some(entry => entry.songId === id));
    if (used.length) fail(409, 'This song is part of a saved lineup. Remove it from those lineups before deleting.', 'SONG_IN_USE', { lineups: used.map(lineup => ({ id: lineup.id, title: lineup.title, date: lineup.date })) });
    await db.batch([
      statement(db, 'INSERT INTO history (id,song_id,data,revision,changed_by,created_at) VALUES (?,?,?,?,?,?)', uid(), id, JSON.stringify(song), song.revision, user.id, now()),
      statement(db, 'DELETE FROM favorites WHERE song_id = ?', id), statement(db, 'DELETE FROM songs WHERE id = ?', id),
    ]);
    return json({ deleted: true });
  }

  if (resource === 'lineups' && !id && method === 'GET') return json({ lineups: await allLineups(db) });
  if (resource === 'lineups' && id && method === 'GET') {
    const lineup = lineupFromRow(await first(db, 'SELECT * FROM lineups WHERE id = ?', id));
    if (!lineup) fail(404, 'This lineup could not be found.', 'NOT_FOUND');
    return json({ lineup });
  }
  if (resource === 'lineups' && ['POST', 'PUT'].includes(method)) {
    permission(user);
    if ((method === 'POST' && id) || (method === 'PUT' && !id)) fail(404, 'This action could not be found.', 'NOT_FOUND');
    const body = await bodyJson(request), lineup = validateLineup(body), time = now();
    await validateRefs(db, lineup);
    if (method === 'POST') {
      const lineupId = uid();
      await db.batch([lineupInsert(db, lineupId, lineup, user.id, time), ...lineupRefStatements(db, lineupId, lineup.entries)]);
      return json({ lineup: lineupFromRow(await first(db, 'SELECT * FROM lineups WHERE id = ?', lineupId)) }, 201);
    }
    const old = lineupFromRow(await first(db, 'SELECT * FROM lineups WHERE id = ?', id));
    if (!old) fail(404, 'This lineup could not be found.', 'NOT_FOUND');
    if (body.revision !== old.revision) fail(409, 'This lineup was changed by someone else. Reload it before saving.', 'REVISION_CONFLICT', { current: old });
    const updates = await db.batch([
      statement(db, 'DELETE FROM lineup_songs WHERE lineup_id=? AND EXISTS (SELECT 1 FROM lineups WHERE id=? AND revision=?)', id, id, body.revision),
      ...lineupRefStatements(db, id, lineup.entries, body.revision),
      statement(db, 'UPDATE lineups SET date=?,title=?,data=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?', lineup.date, lineup.title, JSON.stringify(lineup), time, user.id, id, body.revision),
    ]);
    if (!changes(updates.at(-1))) fail(409, 'This lineup changed. Reload it before saving.', 'REVISION_CONFLICT');
    return json({ lineup: lineupFromRow(await first(db, 'SELECT * FROM lineups WHERE id = ?', id)) });
  }
  if (resource === 'lineups' && id && method === 'DELETE') {
    permission(user);
    const deleted = await statement(db, 'DELETE FROM lineups WHERE id = ?', id).run();
    if (!changes(deleted)) fail(404, 'This lineup could not be found.', 'NOT_FOUND');
    return json({ deleted: true });
  }
  if (resource === 'favorites' && id && method === 'POST') {
    if (!await first(db, 'SELECT id FROM songs WHERE id = ?', id)) fail(404, 'This song could not be found.', 'NOT_FOUND');
    const body = await bodyJson(request);
    if (typeof body.favorite !== 'boolean') fail(400, 'Choose whether to favorite this song.', 'VALIDATION');
    if (body.favorite) await statement(db, 'INSERT OR IGNORE INTO favorites (id,user_id,song_id) VALUES (?,?,?)', `${user.id}:${id}`, user.id, id).run();
    else await statement(db, 'DELETE FROM favorites WHERE user_id=? AND song_id=?', user.id, id).run();
    return json({ favorite: body.favorite });
  }

  if (resource === 'members' && method === 'GET') { permission(user, 'admin'); return json({ members: await rows(db, 'SELECT * FROM members ORDER BY created_at') }); }
  if (resource === 'members' && id && method === 'PUT') {
    permission(user, 'admin'); const body = await bodyJson(request);
    if (!ROLES.has(body.role)) fail(400, 'Choose Admin, Editor or Viewer.', 'VALIDATION');
    const member = await first(db, 'SELECT * FROM members WHERE id = ?', id);
    if (!member) fail(404, 'This member could not be found. They must sign in first.', 'NOT_FOUND');
    if (id === user.id && body.role !== 'admin') fail(409, 'An administrator cannot remove their own admin access.', 'LAST_ADMIN');
    if (member.role === 'admin' && body.role !== 'admin') {
      const count = await first(db, "SELECT COUNT(*) AS count FROM members WHERE role='admin'");
      if (count.count < 2) fail(409, 'Keep at least one administrator.', 'LAST_ADMIN');
    }
    await statement(db, 'UPDATE members SET role=? WHERE id=?', body.role, id).run();
    return json({ member: await first(db, 'SELECT * FROM members WHERE id = ?', id) });
  }

  if (resource === 'files' && !id && method === 'POST') {
    permission(user);
    if (!env.BUCKET) fail(503, 'Original-file storage is not connected yet.', 'STORAGE_UNAVAILABLE');
    const length = Number(request.headers.get('content-length'));
    if (length && length > MAX_UPLOAD + 20_000) fail(413, 'Choose a file smaller than 15 MB.', 'FILE_TOO_LARGE');
    const bytesBody = await limitedBytes(request, MAX_UPLOAD + 20_000);
    let form;
    try { form = await new Response(bytesBody, { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData(); }
    catch { fail(400, 'Choose a valid file to upload.', 'INVALID_FILE'); }
    const file = form.get('file');
    if (!file || typeof file === 'string' || !file.size) fail(400, 'Choose a PDF, DOCX, text or ChordPro file.', 'VALIDATION');
    if (file.size > MAX_UPLOAD) fail(413, 'Choose a file smaller than 15 MB.', 'FILE_TOO_LARGE');
    const name = file.name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 240), ext = name.split('.').pop().toLowerCase();
    const types = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', cho: 'text/plain', pro: 'text/plain', chordpro: 'text/plain' };
    if (!types[ext]) fail(415, 'Supported files: PDF, DOCX, TXT, CHO, PRO and ChordPro.', 'UNSUPPORTED_FILE');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ext === 'pdf' && new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') fail(415, 'This file is not a valid PDF.', 'INVALID_FILE');
    if (ext === 'docx' && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) fail(415, 'This file is not a valid DOCX document.', 'INVALID_FILE');
    const fileId = uid(), storageKey = `originals/${fileId}`, type = types[ext];
    await env.BUCKET.put(storageKey, bytes, { httpMetadata: { contentType: type } });
    try { await statement(db, 'INSERT INTO files (id,name,type,size,storage_key,created_at,uploaded_by) VALUES (?,?,?,?,?,?,?)', fileId, name, type, file.size, storageKey, now(), user.id).run(); }
    catch (error) { await env.BUCKET.delete(storageKey); throw error; }
    return json({ file: { id: fileId, name, type, url: `/api/files/${fileId}` } }, 201);
  }
  if (resource === 'files' && id && method === 'GET') {
    const file = await first(db, 'SELECT * FROM files WHERE id = ?', id);
    if (!file) fail(404, 'This original file could not be found.', 'NOT_FOUND');
    const object = await env.BUCKET?.get(file.storage_key);
    if (!object) fail(404, 'This original file is no longer available.', 'NOT_FOUND');
    return new Response(object.body, { headers: { 'Content-Type': file.type, 'Content-Disposition': `${file.type === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  }

  if (resource === 'backup' && method === 'GET') {
    permission(user, 'admin');
    return json({ format: 'exalt-songbook-backup', version: 1, exportedAt: now(), songs: await allSongs(db), lineups: await allLineups(db),
      files: await rows(db, 'SELECT id,name,type,size,created_at FROM files'), note: 'Original file bytes and member accounts are not included. Download original files separately.' });
  }
  if (resource === 'restore' && method === 'POST') {
    permission(user, 'admin'); const body = await bodyJson(request);
    if (body.format !== 'exalt-songbook-backup' || body.version !== 1 || !Array.isArray(body.songs) || !Array.isArray(body.lineups) || body.songs.length > 3000 || body.lineups.length > 1000) fail(400, 'Choose a valid EXALT Songbook backup.', 'INVALID_BACKUP');
    // Restore is additive. Existing records are deliberately never overwritten.
    const liveSongs = await allSongs(db), knownSongs = new Map(liveSongs.map(song => [song.id, song]));
    const existing = new Set(knownSongs.keys()), known = new Set(existing), time = now();
    const inserts = [];
    for (const input of body.songs) {
      objectItem(input, 'Backup song');
      const songId = field(input.id, 'Song ID', 120, true), song = validateSong(input);
      if (known.has(songId)) continue;
      if (song.attachmentId && !await first(db, 'SELECT id FROM files WHERE id = ?', song.attachmentId)) song.attachmentId = '';
      for (const arrangement of song.arrangements) if (arrangement.attachmentId && !await first(db, 'SELECT id FROM files WHERE id = ?', arrangement.attachmentId)) arrangement.attachmentId = '';
      inserts.push(songInsert(db, songId, song, user.id, time, true)); known.add(songId); knownSongs.set(songId, song);
    }
    const existingLineups = new Set((await allLineups(db)).map(lineup => lineup.id));
    let count = 0;
    for (const input of body.lineups) {
      objectItem(input, 'Backup lineup');
      const lineupId = field(input.id, 'Lineup ID', 120, true), lineup = validateLineup(input);
      if (existingLineups.has(lineupId)) continue;
      if (lineup.entries.some(entry => !known.has(entry.songId))) fail(400, 'A backup lineup refers to a missing song. Nothing was restored.', 'INVALID_BACKUP');
      if (lineup.entries.some(entry => entry.arrangementId && entry.arrangementId !== 'original' && !knownSongs.get(entry.songId)?.arrangements?.some(item => item.id === entry.arrangementId))) fail(400, 'A backup lineup refers to a missing arrangement. Nothing was restored.', 'INVALID_BACKUP');
      inserts.push(lineupInsert(db, lineupId, lineup, user.id, time, true), ...lineupRefStatements(db, lineupId, lineup.entries)); existingLineups.add(lineupId); count++;
    }
    // D1 batch executes atomically; bound restore size avoids unbounded writes.
    if (known.size - existing.size + count > 100) fail(400, 'Restore up to 100 new songs and lineups at a time.', 'RESTORE_TOO_LARGE');
    if (inserts.length) await db.batch(inserts);
    return json({ restoredSongs: known.size - existing.size, restoredLineups: count });
  }
  fail(404, 'This action could not be found.', 'NOT_FOUND');
}

export async function handleApi(request, env) {
  try { return await api(request, env); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code, ...error.extra }, error.status);
    if (error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message)) return json({ error: 'The library changed while you were saving. Refresh it and try again.', code: 'REFERENCE_CONFLICT' }, 409);
    console.error('Songbook request failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The songbook could not complete this request. Please try again.', code: 'SERVER_ERROR' }, 500);
  }
}
