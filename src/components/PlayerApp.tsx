"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PlaylistManager } from "./PlaylistManager";
import { CategorySidebar } from "./CategorySidebar";
import { ChannelList } from "./ChannelList";
import { VideoPlayer } from "./VideoPlayer";
import { Header } from "./Header";
import { ToastContainer } from "./Toast";
import type { Playlist, Channel, Toast } from "@/lib/types";
import * as store from "@/lib/store";
import { parseM3U } from "@/lib/m3u-parser";
import { DEFAULT_PLAYLIST_M3U, DEFAULT_PLAYLIST_NAME } from "@/lib/default-playlist";
import { registerBackHandler } from "@/lib/back-handler";

type View = "playlists" | "player";

export function PlayerApp() {
  const appRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("playlists");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "success" | "error" | "info") => {
    const id = Date.now().toString() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load playlists from IndexedDB
  const fetchPlaylists = useCallback(async () => {
    try {
      const data = await store.getAllPlaylists();
      setPlaylists(data);
    } catch (err) {
      console.error("Failed to load playlists:", err);
    }
  }, []);

  // Charge la playlist par défaut (src/lib/default-playlist.ts) au tout
  // premier lancement, uniquement si aucune playlist n'existe encore.
  const seedDefaultPlaylist = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("default_playlist_seeded")) return;
    localStorage.setItem("default_playlist_seeded", "1");

    try {
      const existing = await store.getAllPlaylists();
      if (existing.length > 0) return; // l'utilisateur a déjà des playlists

      const parsed = parseM3U(DEFAULT_PLAYLIST_M3U);
      if (parsed.length === 0) return; // placeholder pas encore rempli

      const now = new Date().toISOString();
      const playlist = await store.addPlaylist({
        name: DEFAULT_PLAYLIST_NAME,
        url: null,
        type: "m3u",
        xtreamHost: null,
        xtreamUsername: null,
        xtreamPassword: null,
        channelCount: parsed.length,
        createdAt: now,
        updatedAt: now,
        isDefault: true,
      });

      const channels = parsed.map((ch) => ({
        playlistId: playlist.id,
        name: ch.name,
        url: ch.url,
        logo: ch.logo,
        group: ch.group || "Sans catégorie",
        tvgId: ch.tvgId,
        tvgName: ch.tvgName,
        isFavorite: false,
      }));
      await store.addChannels(playlist.id, channels);
    } catch (err) {
      console.error("Échec du chargement de la playlist par défaut :", err);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await seedDefaultPlaylist();
      await fetchPlaylists();
    })();
  }, [seedDefaultPlaylist, fetchPlaylists]);

  // Open a playlist
  const openPlaylist = async (playlist: Playlist) => {
    setLoading(true);
    try {
      const groups = await store.getGroups(playlist.id);
      const enriched = { ...playlist, groups };
      setSelectedPlaylist(enriched);
      setSelectedGroup("all");
      setShowFavorites(false);
      setShowRecent(false);
      setView("player");

      const chs = await store.getChannels(playlist.id);
      chs.sort((a, b) => a.name.localeCompare(b.name));
      setChannels(chs);
    } catch (err) {
      console.error("Failed to open playlist:", err);
      addToast("Erreur d'ouverture de la playlist", "error");
    } finally {
      setLoading(false);
    }
  };

  // Query channels with filters
  const fetchChannels = useCallback(async () => {
    if (!selectedPlaylist) return;
    setLoading(true);
    try {
      if (showRecent) {
        const recent = await store.getRecentChannels(selectedPlaylist.id);
        setChannels(recent);
        setLoading(false);
        return;
      }

      const chs = await store.queryChannels(selectedPlaylist.id, {
        group: selectedGroup,
        search: searchQuery,
        favorites: showFavorites,
      });
      setChannels(chs);
    } catch (err) {
      console.error("Failed to fetch channels:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedPlaylist, selectedGroup, searchQuery, showFavorites, showRecent]);

  useEffect(() => {
    if (view === "player" && selectedPlaylist) {
      fetchChannels();
    }
  }, [view, selectedPlaylist, selectedGroup, searchQuery, showFavorites, showRecent, fetchChannels]);

  // Toggle favorite
  const toggleFavorite = async (channelId: number) => {
    try {
      const newVal = await store.toggleFavorite(channelId);
      setChannels((prev) =>
        prev.map((ch) => (ch.id === channelId ? { ...ch, isFavorite: newVal } : ch))
      );
      if (selectedChannel?.id === channelId) {
        setSelectedChannel((prev) => (prev ? { ...prev, isFavorite: newVal } : null));
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  // Play channel
  const playChannel = async (channel: Channel) => {
    setSelectedChannel(channel);
    if (selectedPlaylist) {
      try {
        await store.recordWatch(selectedPlaylist.id, channel.id);
      } catch { /* ignore */ }
    }
  };

  // Sélection (Entrée télécommande / double-clic) : lance la lecture, le
  // passage en plein écran est déclenché par VideoPlayer lui-même UNE FOIS
  // que la lecture a réellement démarré (voir l'effet sur `fullscreenSignal`
  // dans VideoPlayer.tsx, qui attend l'événement natif "playing").
  // ⚠️ Ne jamais appeler requestFullscreen() ICI avant playChannel() : ça
  // inverserait l'ordre voulu (plein écran d'abord, lecture ensuite).
  const [fullscreenSignal, setFullscreenSignal] = useState(0);
  const playChannelFullscreen = async (channel: Channel) => {
    await playChannel(channel);
    setFullscreenSignal((s) => s + 1);
  };

  // Next / Prev channel
  const navigateChannel = useCallback(
    (direction: 1 | -1) => {
      if (!selectedChannel || channels.length === 0) return;
      const idx = channels.findIndex((ch) => ch.id === selectedChannel.id);
      const newIdx = idx + direction;
      if (newIdx >= 0 && newIdx < channels.length) {
        playChannel(channels[newIdx]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedChannel, channels]
  );

  // Back to playlists
  const goBack = () => {
    setView("playlists");
    setSelectedPlaylist(null);
    setSelectedChannel(null);
    setChannels([]);
    setSearchQuery("");
    setSelectedGroup("all");
    setShowFavorites(false);
    setShowRecent(false);
    fetchPlaylists();
  };

  // Retour universel (Escape/Backspace/GoBack + Android Capacitor +
  // télécommandes Tizen/WebOS + geste back Android). Ferme d'abord le
  // player, puis la vue player, puis laisse quitter l'app.
  useEffect(() => {
    const dispose = registerBackHandler(async () => {
      // 1) Si on est en plein écran vidéo => sortir du plein écran
      if (typeof document !== "undefined") {
        const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
        if (fsEl) {
          try {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if ((document as any).webkitExitFullscreen) await (document as any).webkitExitFullscreen();
          } catch { /* ignore */ }
          return true;
        }
      }

      // 2) Si une chaîne est en lecture => revenir à la liste
      if (view === "player" && selectedChannel) {
        setSelectedChannel(null);
        return true;
      }
      // 3) Si on est dans le player (liste ouverte) => revenir aux playlists
      if (view === "player") {
        goBack();
        return true;
      }
      // 4) Sinon : rien à fermer, laisser l'OS quitter
      return false;
    });
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedChannel]);

  if (view === "playlists") {
    return (
      <div ref={appRef} className="h-[100dvh] flex flex-col overflow-hidden bg-dark-950">
        <Header onBack={null} title="StreamVault" subtitle="IPTV Player — Anti-blocage intégré" />
        <PlaylistManager
          playlists={playlists}
          onOpen={openPlaylist}
          onRefresh={fetchPlaylists}
          onToast={addToast}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  // Dès qu'une chaîne est choisie, on affiche le player en OVERLAY plein
  // écran, quel que soit le format (mobile, tablette, TV). C'est ce qui
  // rend "l'écran de lecture" visible sur TV — l'ancien layout 3 colonnes
  // écrasait le player dans un petit panneau à droite.
  const watching = !!selectedChannel;

  return (
    <div ref={appRef} className="h-[100dvh] flex flex-col overflow-hidden relative bg-dark-950">
      <Header
        onBack={goBack}
        title={selectedPlaylist?.name || "Player"}
        subtitle={selectedPlaylist?.type === "xtream" ? "Xtream Codes" : "M3U"}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showFavorites={showFavorites}
        onToggleFavorites={() => {
          setShowFavorites(!showFavorites);
          setShowRecent(false);
        }}
        showRecent={showRecent}
        onToggleRecent={() => {
          setShowRecent(!showRecent);
          setShowFavorites(false);
        }}
        channelCount={selectedPlaylist?.channelCount}
      />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {!showRecent && (selectedPlaylist?.groups?.length ?? 0) > 1 && (
          <CategorySidebar
            groups={selectedPlaylist?.groups || []}
            selectedGroup={selectedGroup}
            onSelectGroup={(g) => {
              setSelectedGroup(g);
              setShowFavorites(false);
              setShowRecent(false);
            }}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        )}

        <div className="flex md:flex-none min-h-0" style={{ flex: watching ? "0 0 auto" : 1 }}>
          <ChannelList
            channels={channels}
            selectedChannel={selectedChannel}
            onPlay={playChannel}
            onPlayFullscreen={playChannelFullscreen}
            onToggleFavorite={toggleFavorite}
            loading={loading}
          />
        </div>

        {/* Zone de lecture INLINE à droite. 1er clic = lecture ici.
            2e clic (sur la chaîne, sur la vidéo, ou double-clic) = plein écran réel. */}
        <div className="hidden md:flex flex-1 flex-col bg-black min-h-0">
          {watching && selectedChannel ? (
            <VideoPlayer
              channel={selectedChannel}
              onNextChannel={() => navigateChannel(1)}
              onPrevChannel={() => navigateChannel(-1)}
              onBackMobile={() => setSelectedChannel(null)}
              fullscreenSignal={fullscreenSignal}
              onRequestFullscreen={() => setFullscreenSignal((s) => s + 1)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center slide-in-up">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-dark-800 flex items-center justify-center mx-auto mb-6 border border-dark-600/50">
                  <svg className="w-10 h-10 sm:w-12 sm:h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-gray-300 text-lg font-medium mb-1">Sélectionnez une chaîne</p>
                <p className="text-gray-600 text-sm">
                  {channels.length} chaîne{channels.length !== 1 ? "s" : ""} disponible
                  {channels.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile (< md) : pas de panneau à droite, on affiche le player en overlay. */}
      {watching && selectedChannel && (
        <div className="md:hidden fixed inset-0 z-50 bg-black flex flex-col">
          <VideoPlayer
            channel={selectedChannel}
            onNextChannel={() => navigateChannel(1)}
            onPrevChannel={() => navigateChannel(-1)}
            onBackMobile={() => setSelectedChannel(null)}
            fullscreenSignal={fullscreenSignal}
            onRequestFullscreen={() => setFullscreenSignal((s) => s + 1)}
          />
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
