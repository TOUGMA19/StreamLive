"use client";

import type { GroupInfo } from "@/lib/types";

interface CategorySidebarProps {
  groups: GroupInfo[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const groupIcons: Record<string, string> = {
  sport: "⚽",
  foot: "⚽",
  tennis: "🎾",
  basket: "🏀",
  news: "📰",
  info: "📰",
  movie: "🎬",
  film: "🎬",
  cinema: "🎬",
  vod: "🎬",
  series: "📺",
  serie: "📺",
  music: "🎵",
  musique: "🎵",
  kids: "👶",
  enfant: "👶",
  cartoon: "👶",
  documentary: "🎥",
  docu: "🎥",
  entertainment: "🎭",
  divertissement: "🎭",
  education: "📚",
  religion: "🕌",
  cooking: "🍳",
  cuisine: "🍳",
  nature: "🌿",
  travel: "✈️",
  voyage: "✈️",
  science: "🔬",
  tech: "💻",
  auto: "🏎️",
  adult: "🔞",
  xxx: "🔞",
  france: "🇫🇷",
  arabic: "🇸🇦",
  arabe: "🇸🇦",
  usa: "🇺🇸",
  uk: "🇬🇧",
  spain: "🇪🇸",
  espagne: "🇪🇸",
  germany: "🇩🇪",
  allemagne: "🇩🇪",
  italy: "🇮🇹",
  italie: "🇮🇹",
  turk: "🇹🇷",
  portugal: "🇵🇹",
  africa: "🌍",
  afrique: "🌍",
  latino: "🌎",
  india: "🇮🇳",
  inde: "🇮🇳",
};

function getGroupIcon(group: string): string {
  const lower = group.toLowerCase();
  for (const [key, icon] of Object.entries(groupIcons)) {
    if (lower.includes(key)) return icon;
  }
  return "📺";
}

export function CategorySidebar({
  groups,
  selectedGroup,
  onSelectGroup,
  collapsed,
  onToggleCollapse,
}: CategorySidebarProps) {
  const totalChannels = groups.reduce((sum, g) => sum + g.count, 0);

  return (
    <>
      {/* Mobile / tactile : rangée de puces horizontale scrollable (pas de sidebar verticale) */}
      <div className="md:hidden bg-dark-900 border-b border-dark-600/30 flex items-center gap-2 px-3 py-2.5 overflow-x-auto shrink-0">
        <button
          onClick={() => onSelectGroup("all")}
          className={`focusable flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
            selectedGroup === "all"
              ? "bg-accent-500 text-white"
              : "bg-dark-700/70 text-gray-300 border border-dark-500/40"
          }`}
        >
          <span>📡</span> Toutes <span className="text-[10px] opacity-70">{totalChannels}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.group}
            onClick={() => onSelectGroup(g.group)}
            className={`focusable flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
              selectedGroup === g.group
                ? "bg-accent-500 text-white"
                : "bg-dark-700/70 text-gray-300 border border-dark-500/40"
            }`}
          >
            <span>{getGroupIcon(g.group)}</span> {g.group} <span className="text-[10px] opacity-70">{g.count}</span>
          </button>
        ))}
      </div>

      {/* Tablette / bureau / TV : sidebar verticale repliable */}
      <div
        className={`hidden md:flex bg-dark-900 border-r border-dark-600/30 flex-col shrink-0 transition-all duration-300 ${
          collapsed ? "w-[48px]" : "w-40 lg:w-48"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-2.5 py-2 border-b border-dark-600/30">
          {!collapsed && (
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              Catégories
            </span>
          )}
          <button
            onClick={onToggleCollapse}
            className="focusable text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-dark-700"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto py-1">
          {/* All */}
          <button
            onClick={() => onSelectGroup("all")}
            className={`focusable w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-all ${
              selectedGroup === "all"
                ? "bg-accent-500/10 text-accent-300"
                : "text-gray-400 hover:text-white hover:bg-dark-700/50"
            }`}
          >
            <span className={`text-base shrink-0 ${collapsed ? "mx-auto" : ""}`}>📡</span>
            {!collapsed && (
              <div className="flex-1 min-w-0 flex items-center justify-between">
                <span className="text-sm font-medium truncate">Toutes</span>
                <span className="text-[10px] text-gray-600 bg-dark-700 px-1.5 py-0.5 rounded-md">{totalChannels}</span>
              </div>
            )}
            {selectedGroup === "all" && !collapsed && (
              <div className="w-1 h-4 rounded-full bg-accent-500" />
            )}
          </button>

          {groups.map((g) => (
            <button
              key={g.group}
              onClick={() => onSelectGroup(g.group)}
              className={`focusable w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-all ${
                selectedGroup === g.group
                  ? "bg-accent-500/10 text-accent-300"
                  : "text-gray-400 hover:text-white hover:bg-dark-700/50"
              }`}
              title={collapsed ? `${g.group} (${g.count})` : undefined}
            >
              <span className={`text-base shrink-0 ${collapsed ? "mx-auto" : ""}`}>
                {getGroupIcon(g.group)}
              </span>
              {!collapsed && (
                <div className="flex-1 min-w-0 flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{g.group}</span>
                  <span className="text-[10px] text-gray-600 bg-dark-700 px-1.5 py-0.5 rounded-md">{g.count}</span>
                </div>
              )}
              {selectedGroup === g.group && !collapsed && (
                <div className="w-1 h-4 rounded-full bg-accent-500" />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
