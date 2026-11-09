# EXALT Songbook — CCF Tarlac

A private worship song library and service preparation app. Save a song once, find it by title, artist or remembered lyrics, and reference it in future service lineups without copying the song record.

## What is included

- Persistent songs, alternate arrangements, lineups, per-member favorites and edit history.
- Plain lyric and aligned ChordPro chord-sheet views; temporary key transposition.
- Forgiving title/artist/lyric search and duplicate review.
- Manual entry, pasted sheets and reviewed PDF, DOCX, text and ChordPro imports.
- Original uploaded files retained in private file storage.
- Draft/finalized services with ordered songs, arrangement, performance key and notes.
- Responsive desktop/mobile interface, printing, text/ChordPro exports and JSON backup.
- Standalone session authentication with administrator/editor/viewer roles checked by the server, plus automatic browser-storage fallback for static hosting.

## Run locally

Use Node.js 22.13 or later (Node 24 is recommended) and pnpm 11.25.0. From the project directory:

```powershell
pnpm install --frozen-lockfile
pnpm run build
```

Building generates the local Worker configuration. On a fresh local database, apply the included schema migration before opening the app. Do not replay an already applied migration.

```powershell
./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dazzling_moonstone.sql
pnpm run dev
```

The Vite/Workers integration uses the `DB` D1 binding and `BUCKET` R2 binding. Local and hosted databases are separate. Use the current generated `dist/server/wrangler.json` for post-build Wrangler commands when the development command does not have a generated configuration yet.

```powershell
pnpm test
pnpm run build
pnpm run start
```

Use `pnpm run db:generate` only after changing the database schema, and review the newly generated migration before applying it. The included migration is already sufficient for a fresh checkout.

## Deployment

- **Live Hosted App (GitHub Pages):** [https://jcocl.github.io/exalt-songbook/](https://jcocl.github.io/exalt-songbook/)
- **Cloudflare Workers (D1 + R2):** Deploy the built Worker with D1 (`DB`) and R2 (`BUCKET`) bindings for shared multi-member persistence.

## Accounts and permissions

The first authenticated visitor becomes the administrator in an atomic database operation. Later authenticated visitors become viewers. They can read songs/lineups and maintain their own favorites; an administrator can grant editor or administrator access after they sign in.

- **Administrator:** manage songs, lineups, files and member roles; export/restore backups.
- **Editor:** manage songs, alternate arrangements, lineups and file imports.
- **Viewer:** read authorized library content and services; keep personal favorites.

Every write endpoint checks the stored role. Hiding a control is not the authorization mechanism. An administrator cannot demote their own account, and the last administrator cannot be removed. Song/lineup updates carry a revision and reject stale edits instead of overwriting another member's changes.

## Songs and chord format

The canonical editable format is ChordPro-compatible inline notation:

```text
{section:Verse 1}
[G]Example words at the [D/F#]right position

{section:Chorus}
[Em7]Another lyric [Cadd9]line
{comment:Repeat chorus twice}
```

Each chord is attached to the lyric position immediately following it. Plain-lyrics mode removes valid chord annotations while keeping lyric words, line breaks, sections and musical instructions. An alternate arrangement belongs to its song record; a performance key selected in the viewer does not overwrite the stored original.

Lineups store ordered entry documents and a database-enforced song-reference index. Adding a song to a lineup does not create a new song. Songs used by saved lineups cannot be deleted until those references are removed.

## Imports and the supplied reference

The four songs in the supplied November 7, 2026 PDF are seeded once on first authenticated opening. The original reference is retained for comparison. Imported text and source attribution are preserved. Extraction uncertainty is identified for human review; a parser does not invent missing lyrics or chord symbols.

File uploads are restricted to PDF, DOCX, TXT, CHO, PRO and ChordPro, up to 15 MB each. Requests are size-limited while streaming, PDF/DOCX signatures are checked and original-file reads require authentication. Uploaded originals are served with a restrictive document policy and cannot execute application code.

PDFs with selectable text are supported. Multi-column sheets require layout-aware extraction and review. Scanned/image-only PDFs are not automatically transcribed: OCR is not included, so paste authorized text or prepare a text-based PDF. Complex chord placement, unusual fonts, overlapping text and musical diagrams must be checked against the original. DOCX is imported as text, not as executable content or macros.

## Backups and recovery

Administrators can export a versioned JSON backup of all songs, arrangements and lineups. The JSON includes file metadata but not original file bytes, member accounts or favorites. Download important original documents separately and retain copies outside the app.

Restore is additive and transactional. It validates the complete request and song/arrangement references before writing. Existing record IDs are never overwritten; a repeated restore is safe. A single restore can add up to 100 new songs and lineups combined. The Settings file chooser accepts backup files up to 1.5 MB; the API additionally enforces a 2 MB request limit. Larger collections should be restored in batches or migrated using an administrator-managed database process.

Song edits retain the previous revision in history. History is not a replacement for a separately stored backup or the hosting provider's database recovery facilities.

## Intentional choices and limits

- A single Worker with D1 and R2 keeps the ministry tool deployable without maintaining a separate database server or multiple paid services.
- Search uses deterministic normalization, weighted matching and typo tolerance rather than an AI request per keystroke. No third-party lyric scraping occurs.
- Import review is explicit because document text order does not reliably prove chord alignment.
- Offline library access and offline changes are not implemented. Saved records are read from the server; an already open page may remain readable during a temporary disconnection.
- Sharing remains restricted by the Site audience and app membership. The application does not create public lyric links or bypass third-party content restrictions.
- Source lyrics, attribution and arrangements come from supplied/authorized material. The software does not grant redistribution rights.
- The text identity can be replaced by ministry-approved official logo assets. Generated instrumental imagery, if present, is illustrative and is not represented as a photograph of CCF Tarlac.

## Ministry guides

- [User guide](docs/USER-GUIDE.md): finding songs, reviewing imports, preparing services and keeping backups.
- [Visual assets](docs/VISUAL-ASSETS.md): image provenance and branding references.

## API overview

All endpoints require gateway-authenticated identity. JSON writes also enforce same-origin requests and the stored application role.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/bootstrap` | Current member, songs, lineups, personal favorites; members for admin |
| `GET/POST /api/songs` | Read/create songs; possible duplicates return 409 |
| `GET/PUT/DELETE /api/songs/:id` | Read/edit/delete a song; PUT requires `revision` |
| `POST /api/songs/:id/arrangements` | Append an arrangement; requires `revision` |
| `GET /api/songs/:id/history` | Earlier saved revisions |
| `GET/POST /api/lineups` | Read/create services |
| `GET/PUT/DELETE /api/lineups/:id` | Read/edit/delete a service; PUT requires `revision` |
| `POST /api/favorites/:songId` | Set personal `{favorite: true/false}` |
| `POST /api/files` | Multipart `file` upload |
| `GET /api/files/:id` | Authorized original-file read |
| `GET /api/members`, `PUT /api/members/:id` | Admin member roles |
| `GET /api/backup`, `POST /api/restore` | Admin JSON backup and additive restore |

Errors return a readable `error` and stable `code`. Revision conflicts return 409. A duplicate create returns `DUPLICATE_SONG` with candidate songs; the explicit `allowDuplicate: true` flag creates a separate legitimate record after review. Missing references and invalid field values are rejected before saving.
