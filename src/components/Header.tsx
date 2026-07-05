"use client";

import { useEffect, useRef, useState } from "react";

interface HeaderProps {
  onBack: (() => void) | null;
  title: string;
  subtitle?: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  showFavorites?: boolean;
  onToggleFavorites?: () => void;
  showRecent?: boolean;
  onToggleRecent?: () => void;
  channelCount?: number;
}

export function Header({
  onBack,
  title,
  subtitle,
  searchQuery,
  onSearchChange,
  showFavorites,
  onToggleFavorites,
  showRecent,
  onToggleRecent,
  channelCount,
}: HeaderProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Ctrl+K shortcut for search
  useEffect(() => {
    if (!onSearchChange) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSearchChange]);

  return (
    <header className="relative glass border-b border-dark-600/50 px-2.5 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 shrink-0 z-30 min-h-14">
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-gray-400 hover:text-white hover:bg-dark-600 active:bg-dark-600 transition-all shrink-0"
          title="Retour (Échap)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Logo & Title */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative w-9 h-9 shrink-0">
          <img src="/logo.png" alt="StreamVault" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-white leading-tight truncate">{title}</h1>
          {subtitle && <p className="hidden sm:block text-xs text-gray-500 leading-tight truncate">{subtitle}</p>}
        </div>
      </div>

      {/* Channel count badge */}
      {channelCount !== undefined && channelCount > 0 && (
        <span className="hidden lg:inline-block bg-dark-600 text-accent-300 text-xs px-2.5 py-1 rounded-full font-medium shrink-0">
          {channelCount.toLocaleString("fr-FR")} chaînes
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search & Filters */}
      {onSearchChange && (
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Barre de recherche : toujours visible à partir de sm, en overlay repliable sur mobile */}
          <div className="relative hidden sm:block">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Rechercher..."
              className="w-40 md:w-56 bg-dark-700/80 border border-dark-500/50 rounded-lg pl-9 pr-4 md:pr-14 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500/50 focus:bg-dark-700 transition-all"
            />
            <kbd className="hidden md:block absolute right-2 top-1/2 -translate-y-1/2">⌘K</kbd>
          </div>

          {/* Bouton recherche mobile */}
          <button
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="sm:hidden flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-white hover:bg-dark-600 transition-all shrink-0"
            title="Rechercher"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {onToggleRecent && (
            <button
              onClick={onToggleRecent}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                showRecent
                  ? "bg-accent-500/20 text-accent-300 border border-accent-500/30"
                  : "bg-dark-700/50 text-gray-400 border border-dark-500/50 hover:text-white hover:bg-dark-600"
              }`}
              title="Récemment regardées"
            >
              <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden md:inline">Récent</span>
            </button>
          )}

          {onToggleFavorites && (
            <button
              onClick={onToggleFavorites}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                showFavorites
                  ? "bg-red-500/20 text-red-300 border border-red-500/30"
                  : "bg-dark-700/50 text-gray-400 border border-dark-500/50 hover:text-white hover:bg-dark-600"
              }`}
              title="Favoris"
            >
              <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill={showFavorites ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              <span className="hidden md:inline">Favoris</span>
            </button>
          )}
        </div>
      )}

      {/* Overlay recherche plein-largeur sur mobile */}
      {onSearchChange && mobileSearchOpen && (
        <div className="absolute left-0 right-0 top-full sm:hidden bg-dark-800 border-b border-dark-600/50 p-3 z-40 fade-in">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              autoFocus
              type="text"
              value={searchQuery || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Rechercher une chaîne..."
              className="w-full bg-dark-700/80 border border-dark-500/50 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500/50 focus:bg-dark-700 transition-all"
            />
          </div>
        </div>
      )}
    </header>
  );
}
