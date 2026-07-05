"use client";

import { useState, useRef, useEffect } from "react";
import type { Channel } from "@/lib/types";
import { proxyImageUrl } from "@/lib/proxy";

interface ChannelListProps {
  channels: Channel[];
  selectedChannel: Channel | null;
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channelId: number) => void;
  loading: boolean;
}

export function ChannelList({
  channels,
  selectedChannel,
  onPlay,
  onToggleFavorite,
  loading,
}: ChannelListProps) {
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());
  const selectedRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedChannel?.id]);

  if (loading) {
    return (
      <div className="w-full md:w-72 lg:w-80 bg-dark-900 md:border-r border-dark-600/30 flex items-center justify-center shrink-0 py-12 md:py-0">
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
    <div className="w-full md:w-72 lg:w-80 bg-dark-900 md:border-r border-dark-600/30 flex flex-col shrink-0 min-h-0">
      <div className="px-3 py-2 border-b border-dark-600/30 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Chaînes</span>
        <span className="text-[10px] text-gray-600 bg-dark-700 px-2 py-0.5 rounded-full">{channels.length}</span>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {channels.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500 text-sm">Aucune chaîne trouvée</p>
            <p className="text-gray-600 text-xs mt-1">Essayez une autre recherche ou catégorie</p>
          </div>
        ) : (
          channels.map((channel) => {
            const isSelected = selectedChannel?.id === channel.id;
            return (
              <div
                key={channel.id}
                ref={isSelected ? selectedRef : null}
                role="button"
                tabIndex={0}
                onClick={() => onPlay(channel)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(channel); }
                }}
                className={`channel-item focusable ${isSelected ? "active" : ""} flex items-center gap-3 px-3 py-3 md:py-2 cursor-pointer min-h-[60px] md:min-h-0`}
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
          })
        )}
      </div>
    </div>
  );
}
