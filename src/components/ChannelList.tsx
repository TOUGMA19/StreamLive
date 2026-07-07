"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { Channel } from "@/lib/types";
import { proxyImageUrl } from "@/lib/proxy";

interface ChannelListProps {
  channels: Channel[];
  selectedChannel: Channel | null;
  onPlay: (channel: Channel) => void;
  onPlayFullscreen?: (channel: Channel) => void;
  onToggleFavorite: (channelId: number) => void;
  loading: boolean;
}

// Hauteur fixe par ligne (identique sur mobile et desktop) : indispensable
// pour calculer quelles lignes sont visibles sans devoir mesurer le DOM.
const ITEM_HEIGHT = 60;
// Nombre de lignes supplémentaires rendues au-dessus/en-dessous de la zone
// visible, pour éviter un "flash" blanc pendant un scroll rapide.
const OVERSCAN = 10;

export function ChannelList({
  channels,
  selectedChannel,
  onPlay,
  onPlayFullscreen,
  onToggleFavorite,
  loading,
}: ChannelListProps) {
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Mesure la hauteur réellement disponible (et la ré-évalue si la fenêtre change)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Garde le canal sélectionné visible (remplace l'ancien scrollIntoView,
  // qui nécessitait que la ligne existe déjà dans le DOM)
  useEffect(() => {
    if (!selectedChannel || !listRef.current) return;
    const idx = channels.findIndex((c) => c.id === selectedChannel.id);
    if (idx === -1) return;
    setFocusedIndex(idx);
    const el = listRef.current;
    const itemTop = idx * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    if (itemTop < el.scrollTop) {
      el.scrollTop = itemTop;
    } else if (itemBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = itemBottom - el.clientHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel?.id]);

  useEffect(() => {
    setFocusedIndex((idx) => Math.min(Math.max(idx, 0), Math.max(channels.length - 1, 0)));
  }, [channels.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || channels.length === 0) return;
    const itemTop = focusedIndex * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    if (itemTop < el.scrollTop) {
      el.scrollTop = itemTop;
      setScrollTop(itemTop);
    } else if (itemBottom > el.scrollTop + el.clientHeight) {
      const nextScrollTop = itemBottom - el.clientHeight;
      el.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
    requestAnimationFrame(() => {
      el.querySelector<HTMLElement>(`[data-channel-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
    });
  }, [focusedIndex, channels.length]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const moveFocus = useCallback((nextIndex: number) => {
    if (channels.length === 0) return;
    setFocusedIndex(Math.min(Math.max(nextIndex, 0), channels.length - 1));
  }, [channels.length]);

  const activateChannel = useCallback((channel: Channel, fullscreen = false) => {
    if (fullscreen && onPlayFullscreen) {
      onPlayFullscreen(channel);
      return;
    }
    onPlay(channel);
  }, [onPlay, onPlayFullscreen]);

  const handleListKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const keyCode = e.keyCode || (e.nativeEvent as unknown as { which?: number }).which || 0;
    const isConfirm = e.key === "Enter" || e.key === " " || keyCode === 13 || keyCode === 23;
    const pageSize = Math.max(1, Math.floor(viewportHeight / ITEM_HEIGHT) - 1);
    if (isConfirm) {
      const channel = channels[focusedIndex];
      if (channel) {
        e.preventDefault();
        e.stopPropagation();
        activateChannel(channel, true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        moveFocus(focusedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        moveFocus(focusedIndex - 1);
        break;
      case "PageDown":
        e.preventDefault();
        e.stopPropagation();
        moveFocus(focusedIndex + pageSize);
        break;
      case "PageUp":
        e.preventDefault();
        e.stopPropagation();
        moveFocus(focusedIndex - pageSize);
        break;
      case "Home":
        e.preventDefault();
        e.stopPropagation();
        moveFocus(0);
        break;
      case "End":
        e.preventDefault();
        e.stopPropagation();
        moveFocus(channels.length - 1);
        break;
    }
  }, [activateChannel, channels, focusedIndex, moveFocus, viewportHeight]);

  const totalHeight = channels.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    channels.length,
    Math.ceil((scrollTop + viewportHeight) / ITEM_HEIGHT) + OVERSCAN
  );
  const visibleChannels = useMemo(
    () => channels.slice(startIndex, endIndex),
    [channels, startIndex, endIndex]
  );

  if (loading) {
    return (
      <div className="w-full md:w-72 lg:w-80 xl:w-96 2xl:w-[420px] bg-dark-900 md:border-r border-dark-600/30 flex items-center justify-center shrink-0 py-12 md:py-0">
        <div className="text-center">
          <svg className="w-8 h-8 text-accent-500 spinner mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-gray-500 text-xs">Chargement des chaînes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full md:w-72 lg:w-80 xl:w-96 2xl:w-[420px] bg-dark-900 md:border-r border-dark-600/30 flex flex-col shrink-0 min-h-0">
      <div className="px-3 py-2 border-b border-dark-600/30 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Chaînes</span>
        <span className="text-[10px] text-gray-600 bg-dark-700 px-2 py-0.5 rounded-full">
          {channels.length.toLocaleString("fr-FR")}
        </span>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto relative"
        onScroll={handleScroll}
        onKeyDownCapture={handleListKeyDown}
      >
        {channels.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500 text-sm">Aucune chaîne trouvée</p>
            <p className="text-gray-600 text-xs mt-1">Essayez une autre recherche ou catégorie</p>
          </div>
        ) : (
          // Le conteneur fait toute la hauteur "virtuelle" (comme s'il y avait
          // vraiment 5 millions de lignes), mais seules les lignes visibles
          // (visibleChannels) sont de vrais éléments DOM, positionnés en absolu
          // à leur place calculée. C'est ce qui évite le crash du navigateur.
          <div style={{ height: totalHeight, position: "relative" }}>
            {visibleChannels.map((channel, i) => {
              const actualIndex = startIndex + i;
              const isSelected = selectedChannel?.id === channel.id;
              return (
                <div
                  key={channel.id}
                  role="button"
                  tabIndex={actualIndex === focusedIndex ? 0 : -1}
                  data-channel-index={actualIndex}
                  onFocus={() => setFocusedIndex(actualIndex)}
                  onClick={() => activateChannel(channel)}
                  onDoubleClick={() => onPlayFullscreen?.(channel)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      activateChannel(channel, true);
                    }
                  }}
                  style={{ position: "absolute", top: actualIndex * ITEM_HEIGHT, left: 0, right: 0, height: ITEM_HEIGHT }}
                  className={`channel-item focusable ${isSelected ? "active" : ""} flex items-center gap-3 px-3 cursor-pointer`}
                >
                  <div className="w-10 h-10 md:w-9 md:h-9 rounded-lg overflow-hidden bg-dark-700 flex items-center justify-center shrink-0 border border-dark-600/30">
                    {channel.logo && !imgErrors.has(channel.id) ? (
                      <img
                        src={proxyImageUrl(channel.logo) || ""}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setImgErrors((prev) => new Set(prev).add(channel.id))}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="text-sm">📺</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={`text-sm md:text-[13px] font-medium truncate ${isSelected ? "text-accent-300" : "text-gray-200"}`}>
                      {channel.name}
                    </div>
                    <div className="text-xs md:text-[10px] text-gray-600 truncate">{channel.group}</div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleFavorite(channel.id); }}
                      className="focusable p-2 md:p-1 transition-colors rounded-md hover:bg-dark-600"
                    >
                      <svg
                        className={`w-4 h-4 md:w-3.5 md:h-3.5 ${channel.isFavorite ? "text-red-400" : "text-gray-700 hover:text-red-400"}`}
                        fill={channel.isFavorite ? "currentColor" : "none"}
                        viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>

                    {isSelected && (
                      <div className="flex items-end gap-px h-4 ml-1">
                        <div className="equalizer-bar eq-1" />
                        <div className="equalizer-bar eq-2" />
                        <div className="equalizer-bar eq-3" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
