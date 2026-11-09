import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const appState = sqliteTable("app_state", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("viewer"),
  createdAt: text("created_at").notNull(),
});

export const songs = sqliteTable("songs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  content: text("content").notNull(),
  searchText: text("search_text").notNull().default(""),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
}, (table) => [index("songs_title_idx").on(table.title), index("songs_artist_idx").on(table.artist)]);

export const lineups = sqliteTable("lineups", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
}, (table) => [index("lineups_date_idx").on(table.date)]);

export const favorites = sqliteTable("favorites", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => members.id),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "cascade" }),
});

// The JSON lineup document preserves ordered entries; these rows enforce its
// song relationships at database level, including during concurrent requests.
export const lineupSongs = sqliteTable("lineup_songs", {
  id: text("id").primaryKey(),
  lineupId: text("lineup_id").notNull().references(() => lineups.id, { onDelete: "cascade" }),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "restrict" }),
}, (table) => [index("lineup_songs_song_idx").on(table.songId)]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: text("created_at").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => members.id),
});

export const history = sqliteTable("history", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull(),
  data: text("data").notNull(),
  revision: integer("revision").notNull(),
  changedBy: text("changed_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("history_song_idx").on(table.songId)]);
