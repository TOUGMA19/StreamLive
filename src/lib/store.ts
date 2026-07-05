/**
 * Client-side IndexedDB store — replaces all server/DB dependencies.
 * Everything runs in the browser. No server needed.
 */

import type { Playlist, Channel, GroupInfo } from "./types";

const DB_NAME = "streamvault";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("channels")) {
        const chStore = db.createObjectStore("channels", { keyPath: "id", autoIncrement: true });
        chStore.createIndex("playlistId", "playlistId", { unique: false });
        chStore.createIndex("playlistGroup", ["playlistId", "group"], { unique: false });
      }
      if (!db.objectStoreNames.contains("recent")) {
        const recStore = db.createObjectStore("recent", { keyPath: "id", autoIncrement: true });
        recStore.createIndex("playlistId", "playlistId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode) {
  return db.transaction(stores, mode);
}

// ─── Playlists ────────────────────────────────────────────────

export async function getAllPlaylists(): Promise<Playlist[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "playlists", "readonly");
    const req = t.objectStore("playlists").getAll();
    req.onsuccess = () => {
      const list = (req.result as Playlist[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPlaylist(id: number): Promise<Playlist | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "playlists", "readonly");
    const req = t.objectStore("playlists").get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function addPlaylist(data: Omit<Playlist, "id" | "groups">): Promise<Playlist> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "playlists", "readwrite");
    const req = t.objectStore("playlists").add(data);
    req.onsuccess = () => resolve({ ...data, id: req.result as number });
    req.onerror = () => reject(req.error);
  });
}

export async function updatePlaylist(id: number, data: Partial<Playlist>): Promise<void> {
  const db = await openDB();
  const existing = await getPlaylist(id);
  if (!existing) return;
  return new Promise((resolve, reject) => {
    const t = tx(db, "playlists", "readwrite");
    const req = t.objectStore("playlists").put({ ...existing, ...data, id });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deletePlaylist(id: number): Promise<void> {
  const db = await openDB();
  // Delete channels first
  const channels = await getChannels(id);
  const t2 = tx(db, ["channels", "recent"], "readwrite");
  for (const ch of channels) {
    t2.objectStore("channels").delete(ch.id);
  }
  // Delete recent entries for those channels
  const recStore = t2.objectStore("recent");
  const recIdx = recStore.index("playlistId");
  const recReq = recIdx.openCursor(IDBKeyRange.only(id));
  recReq.onsuccess = () => {
    const cursor = recReq.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };
  await new Promise<void>((resolve) => { t2.oncomplete = () => resolve(); });

  // Delete playlist
  return new Promise((resolve, reject) => {
    const t3 = tx(db, "playlists", "readwrite");
    const req = t3.objectStore("playlists").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Channels ─────────────────────────────────────────────────

// Taille des lots d'insertion : assez grand pour être efficace, assez petit
// pour laisser l'UI respirer entre deux lots (évite le gel du navigateur
// sur les très grosses playlists).
const INSERT_BATCH_SIZE = 3000;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function addChannels(
  playlistId: number,
  channels: Omit<Channel, "id">[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const db = await openDB();
  const total = channels.length;

  for (let offset = 0; offset < total; offset += INSERT_BATCH_SIZE) {
    const batch = channels.slice(offset, offset + INSERT_BATCH_SIZE);
    await new Promise<void>((resolve, reject) => {
      const t2 = tx(db, "channels", "readwrite");
      const store = t2.objectStore("channels");
      for (const ch of batch) {
        store.add(ch);
      }
      t2.oncomplete = () => resolve();
      t2.onerror = () => reject(t2.error);
    });
    onProgress?.(Math.min(offset + batch.length, total), total);
    // Rend la main au navigateur entre deux lots (scroll, animations,
    // interactions restent fluides même pendant un import massif).
    await nextTick();
  }
}

export async function getChannels(playlistId: number): Promise<Channel[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t2 = tx(db, "channels", "readonly");
    const idx = t2.objectStore("channels").index("playlistId");
    const req = idx.getAll(IDBKeyRange.only(playlistId));
    req.onsuccess = () => resolve(req.result as Channel[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteChannelsByPlaylist(playlistId: number): Promise<void> {
  const channels = await getChannels(playlistId);
  const db = await openDB();
  const t2 = tx(db, "channels", "readwrite");
  for (const ch of channels) {
    t2.objectStore("channels").delete(ch.id);
  }
  await new Promise<void>((resolve) => { t2.oncomplete = () => resolve(); });
}

export async function toggleFavorite(channelId: number): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t2 = tx(db, "channels", "readwrite");
    const store = t2.objectStore("channels");
    const getReq = store.get(channelId);
    getReq.onsuccess = () => {
      const ch = getReq.result as Channel;
      if (!ch) { resolve(false); return; }
      ch.isFavorite = !ch.isFavorite;
      store.put(ch);
      t2.oncomplete = () => resolve(ch.isFavorite);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ─── Groups ───────────────────────────────────────────────────

export async function getGroups(playlistId: number): Promise<GroupInfo[]> {
  const channels = await getChannels(playlistId);
  const map = new Map<string, number>();
  for (const ch of channels) {
    map.set(ch.group, (map.get(ch.group) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

// ─── Filtering ────────────────────────────────────────────────

export async function queryChannels(
  playlistId: number,
  opts: { group?: string; search?: string; favorites?: boolean }
): Promise<Channel[]> {
  let channels = await getChannels(playlistId);

  if (opts.group && opts.group !== "all") {
    channels = channels.filter((ch) => ch.group === opts.group);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    channels = channels.filter((ch) => ch.name.toLowerCase().includes(q));
  }
  if (opts.favorites) {
    channels = channels.filter((ch) => ch.isFavorite);
  }

  channels.sort((a, b) => a.name.localeCompare(b.name));
  return channels;
}

// ─── Recently watched ─────────────────────────────────────────

export async function recordWatch(playlistId: number, channelId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t2 = tx(db, "recent", "readwrite");
    t2.objectStore("recent").add({ playlistId, channelId, watchedAt: new Date().toISOString() });
    t2.oncomplete = () => resolve();
    t2.onerror = () => reject(t2.error);
  });
}

export async function getRecentChannels(playlistId: number): Promise<Channel[]> {
  const db = await openDB();
  const allRecent: { channelId: number; watchedAt: string }[] = await new Promise((resolve, reject) => {
    const t2 = tx(db, "recent", "readonly");
    const idx = t2.objectStore("recent").index("playlistId");
    const req = idx.getAll(IDBKeyRange.only(playlistId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Deduplicate, keep most recent per channel
  const map = new Map<number, string>();
  for (const r of allRecent) {
    const existing = map.get(r.channelId);
    if (!existing || r.watchedAt > existing) {
      map.set(r.channelId, r.watchedAt);
    }
  }

  // Sort by most recent
  const sorted = Array.from(map.entries()).sort((a, b) => b[1].localeCompare(a[1]));
  const top20 = sorted.slice(0, 20);

  // Fetch channel objects
  const allChannels = await getChannels(playlistId);
  const channelMap = new Map(allChannels.map((ch) => [ch.id, ch]));

  return top20
    .map(([id]) => channelMap.get(id))
    .filter((ch): ch is Channel => ch !== undefined);
}

// ─── Export / Import full data ────────────────────────────────

export async function exportAllData(): Promise<string> {
  const playlists = await getAllPlaylists();
  const all: { playlists: Playlist[]; channels: Channel[] } = { playlists, channels: [] };
  for (const p of playlists) {
    const chs = await getChannels(p.id);
    all.channels.push(...chs);
  }
  return JSON.stringify(all);
}
