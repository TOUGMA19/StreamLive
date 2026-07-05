import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url"),
  type: text("type").notNull().default("m3u"), // m3u, xtream
  xtreamHost: text("xtream_host"),
  xtreamUsername: text("xtream_username"),
  xtreamPassword: text("xtream_password"),
  channelCount: integer("channel_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull().references(() => playlists.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  logo: text("logo"),
  group: text("group_name").notNull().default("Uncategorized"),
  tvgId: text("tvg_id"),
  tvgName: text("tvg_name"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const recentlyWatched = pgTable("recently_watched", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  watchedAt: timestamp("watched_at").defaultNow().notNull(),
});
