"use client";

import { useState, useEffect, useCallback } from "react";
import { PlaylistManager } from "./PlaylistManager";
import { CategorySidebar } from "./CategorySidebar";
import { ChannelList } from "./ChannelList";
import { VideoPlayer } from "./VideoPlayer";
import { Header } from "./Header";
import { ToastContainer } from "./Toast";
import type { Playlist, Channel, Toast } from "@/lib/types";
import * as store from "@/lib/store";

type View = "playlists" | "player";

export function PlayerApp() {
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

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

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

  // Escape key to go back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        view === "player" &&
        !(e.target as HTMLElement).closest("input")
      ) {
        if (!document.fullscreenElement) goBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (view === "playlists") {
    return (
      <div className="h-[100dvh] flex flex-col overflow-hidden">
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

  // Sur mobile/tablette (< md), on n'a pas la place pour 3 colonnes : on affiche soit
  // la liste (catégories + chaînes), soit le lecteur plein écran, jamais les deux.
  const mobileWatching = !!selectedChannel;

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <div className={mobileWatching ? "hidden md:block" : "block"}>
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
      </div>
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {!showRecent && (
          <div className={mobileWatching ? "hidden md:block" : "block"}>
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
          </div>
        )}

        <div className={`${mobileWatching ? "hidden md:flex" : "flex"} flex-1 md:flex-none min-h-0`}>
          <ChannelList
            channels={channels}
            selectedChannel={selectedChannel}
            onPlay={playChannel}
            onToggleFavorite={toggleFavorite}
            loading={loading}
          />
        </div>

        <div className={`${mobileWatching ? "flex" : "hidden md:flex"} flex-1 flex-col bg-black min-h-0`}>
          {selectedChannel ? (
            <VideoPlayer
              channel={selectedChannel}
              onNextChannel={() => navigateChannel(1)}
              onPrevChannel={() => navigateChannel(-1)}
              onBackMobile={() => setSelectedChannel(null)}
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
                <div className="hidden md:flex items-center justify-center gap-4 mt-6 text-xs text-gray-600">
                  <span><kbd>Shift+↑↓</kbd> Zapper</span>
                  <span><kbd>F</kbd> Plein écran</span>
                  <span><kbd>?</kbd> Aide</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
