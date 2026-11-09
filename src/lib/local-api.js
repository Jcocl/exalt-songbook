import reference from '../data/reference-songs.json';

const STORAGE_KEY = 'exalt-songbook-static-store-v1';

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const now = new Date().toISOString();
  const songs = (reference.songs || []).map((s, i) => ({
    ...s,
    id: s.id || `seed-song-${i + 1}`,
    arrangements: s.arrangements || [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }));
  const seedLineup = reference.lineup
    ? [
        {
          id: reference.lineup.id || 'reference-lineup-2026-11-07',
          title: reference.lineup.title || 'Exalt Tarlac · Reference lineup',
          date: reference.lineup.date || '2026-11-07',
          status: reference.lineup.status || 'draft',
          notes: reference.lineup.notes || '',
          entries:
            reference.lineup.entries ||
            songs.map((s, idx) => ({
              id: `entry-${idx + 1}`,
              songId: s.id,
              key: s.key,
              arrangementId: 'original',
              notes: '',
            })),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]
    : [];
  const initial = {
    user: { id: 'admin-local', email: 'worship@ccftarlac.org', name: 'CCF Tarlac Worship', role: 'admin' },
    songs,
    lineups: seedLineup,
    favorites: [],
    members: [
      { id: 'admin-local', email: 'worship@ccftarlac.org', name: 'CCF Tarlac Worship', role: 'admin' },
    ],
  };
  saveStore(initial);
  return initial;
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

export async function localApi(path, method = 'GET', body) {
  const store = loadStore();
  const parts = String(path).replace(/^\/+/, '').split('/').filter(Boolean);
  const [resource, id, action] = parts;
  const now = new Date().toISOString();

  if (resource === 'bootstrap' && method === 'GET') {
    return {
      user: store.user,
      songs: store.songs,
      lineups: store.lineups,
      favorites: store.favorites,
      members: store.members,
    };
  }

  if (resource === 'session') {
    return { user: store.user };
  }

  if (resource === 'favorites' && id && method === 'POST') {
    const fav = Boolean(body?.favorite);
    store.favorites = fav
      ? [...new Set([...store.favorites, id])]
      : store.favorites.filter(x => x !== id);
    saveStore(store);
    return { favorite: fav };
  }

  if (resource === 'songs' && !id && method === 'POST') {
    const song = {
      ...body,
      id: crypto.randomUUID ? crypto.randomUUID() : 'song-' + Date.now(),
      arrangements: body.arrangements || [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.songs.push(song);
    saveStore(store);
    return { song };
  }

  if (resource === 'songs' && id && !action && method === 'PUT') {
    const idx = store.songs.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Song not found.');
    const updated = {
      ...store.songs[idx],
      ...body,
      id,
      revision: (store.songs[idx].revision || 1) + 1,
      updatedAt: now,
    };
    store.songs[idx] = updated;
    saveStore(store);
    return { song: updated };
  }

  if (resource === 'songs' && id && action === 'arrangements' && method === 'POST') {
    const idx = store.songs.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Song not found.');
    const arr = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'arr-' + Date.now(),
      name: body.name || 'Arrangement',
      key: body.key || store.songs[idx].key,
      content: body.content || '',
      notes: body.notes || '',
      source: body.source || '',
      originalSource: body.originalSource || '',
    };
    store.songs[idx].arrangements = [...(store.songs[idx].arrangements || []), arr];
    store.songs[idx].revision = (store.songs[idx].revision || 1) + 1;
    store.songs[idx].updatedAt = now;
    saveStore(store);
    return { song: store.songs[idx] };
  }

  if (resource === 'songs' && id && method === 'DELETE') {
    store.songs = store.songs.filter(s => s.id !== id);
    store.favorites = store.favorites.filter(f => f !== id);
    saveStore(store);
    return { deleted: true };
  }

  if (resource === 'lineups' && !id && method === 'POST') {
    const lineup = {
      ...body,
      id: crypto.randomUUID ? crypto.randomUUID() : 'lineup-' + Date.now(),
      entries: (body.entries || []).map((e, i) => ({ ...e, id: e.id || `entry-${Date.now()}-${i}` })),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.lineups.unshift(lineup);
    saveStore(store);
    return { lineup };
  }

  if (resource === 'lineups' && id && method === 'PUT') {
    const idx = store.lineups.findIndex(l => l.id === id);
    if (idx === -1) throw new Error('Lineup not found.');
    const updated = {
      ...store.lineups[idx],
      ...body,
      id,
      revision: (store.lineups[idx].revision || 1) + 1,
      updatedAt: now,
    };
    store.lineups[idx] = updated;
    saveStore(store);
    return { lineup: updated };
  }

  if (resource === 'lineups' && id && method === 'DELETE') {
    store.lineups = store.lineups.filter(l => l.id !== id);
    saveStore(store);
    return { deleted: true };
  }

  if (resource === 'files' && method === 'POST') {
    return { file: { id: 'local-file-' + Date.now(), name: 'uploaded-file', url: '#' } };
  }

  if (resource === 'backup' && method === 'GET') {
    return {
      format: 'exalt-songbook-backup',
      version: 1,
      exportedAt: now,
      songs: store.songs,
      lineups: store.lineups,
      files: [],
    };
  }

  if (resource === 'restore' && method === 'POST') {
    let added = 0;
    for (const s of body?.songs || []) {
      if (!store.songs.some(x => x.id === s.id)) {
        store.songs.push(s);
        added++;
      }
    }
    for (const l of body?.lineups || []) {
      if (!store.lineups.some(x => x.id === l.id)) {
        store.lineups.push(l);
      }
    }
    saveStore(store);
    return { restoredSongs: added, message: `${added} songs restored` };
  }

  return {};
}
