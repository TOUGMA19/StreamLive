"use client";

import { useState, useRef, useCallback } from "react";
import type { Playlist } from "@/lib/types";
import { parseM3U } from "@/lib/m3u-parser";
import { fetchWithCorsRetry } from "@/lib/proxy";
import * as store from "@/lib/store";

interface PlaylistManagerProps {
  playlists: Playlist[];
  onOpen: (playlist: Playlist) => void;
  onRefresh: () => void;
  onToast: (msg: string, type: "success" | "error" | "info") => void;
}

export function PlaylistManager({ playlists, onOpen, onRefresh, onToast }: PlaylistManagerProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<"url" | "file" | "xtream">("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [xtreamHost, setXtreamHost] = useState("");
  const [xtreamUsername, setXtreamUsername] = useState("");
  const [xtreamPassword, setXtreamPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [progress, setProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName(""); setUrl(""); setXtreamHost(""); setXtreamUsername(""); setXtreamPassword("");
    setError(""); setAddMode("url"); setProgress("");
  };

  const importM3UContent = async (content: string, playlistName: string, playlistUrl: string | null, type: string, xtream?: { host: string; user: string; pass: string }) => {
    setProgress("Analyse du contenu M3U...");
    const parsed = parseM3U(content);
    if (parsed.length === 0) { setError("Aucune chaîne trouvée"); setProgress(""); return; }

    setProgress(`${parsed.length} chaînes trouvées. Enregistrement...`);
    const now = new Date().toISOString();
    const playlist = await store.addPlaylist({
      name: playlistName,
      url: playlistUrl,
      type,
      xtreamHost: xtream?.host || null,
      xtreamUsername: xtream?.user || null,
      xtreamPassword: xtream?.pass || null,
      channelCount: parsed.length,
      createdAt: now,
      updatedAt: now,
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

    await store.addChannels(playlist.id, channels, (done, total) => {
      const pct = Math.round((done / total) * 100);
      setProgress(`Enregistrement... ${done.toLocaleString("fr-FR")}/${total.toLocaleString("fr-FR")} (${pct}%)`);
    });
    setProgress("");
    setShowAddModal(false);
    resetForm();
    onRefresh();
    onToast(`"${playlistName}" ajoutée — ${parsed.length} chaînes`, "success");
  };

  const handleAddByUrl = async () => {
    if (!name.trim() || !url.trim()) { setError("Le nom et l'URL sont requis"); return; }
    setLoading(true); setError("");
    try {
      setProgress("Téléchargement de la playlist...");
      const content = await fetchWithCorsRetry(url.trim());
      await importM3UContent(content, name.trim(), url.trim(), "m3u");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de téléchargement");
      setProgress("");
    } finally { setLoading(false); }
  };

  const handleAddByXtream = async () => {
    if (!name.trim() || !xtreamHost.trim() || !xtreamUsername.trim() || !xtreamPassword.trim()) {
      setError("Tous les champs sont requis"); return;
    }
    setLoading(true); setError("");
    try {
      const host = xtreamHost.trim().replace(/\/+$/, "");
      const xtreamUrl = `${host}/get.php?username=${encodeURIComponent(xtreamUsername.trim())}&password=${encodeURIComponent(xtreamPassword.trim())}&type=m3u_plus&output=ts`;
      setProgress("Connexion au serveur Xtream...");
      const content = await fetchWithCorsRetry(xtreamUrl);
      await importM3UContent(content, name.trim(), xtreamUrl, "xtream", {
        host, user: xtreamUsername.trim(), pass: xtreamPassword.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion Xtream");
      setProgress("");
    } finally { setLoading(false); }
  };

  const handleAddByFile = async (file: File) => {
    const finalName = name.trim() || file.name.replace(/\.(m3u8?|txt)$/i, "");
    setLoading(true); setError("");
    try {
      const content = await file.text();
      await importM3UContent(content, finalName, null, "m3u");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de lecture du fichier");
      setProgress("");
    } finally { setLoading(false); }
  };

  const handleRefresh = async (playlist: Playlist, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!playlist.url && playlist.type !== "xtream") {
      onToast("Pas d'URL source pour rafraîchir", "error"); return;
    }
    setRefreshingId(playlist.id);
    try {
      let fetchUrl = playlist.url;
      if (playlist.type === "xtream" && playlist.xtreamHost && playlist.xtreamUsername && playlist.xtreamPassword) {
        const host = playlist.xtreamHost.replace(/\/+$/, "");
        fetchUrl = `${host}/get.php?username=${encodeURIComponent(playlist.xtreamUsername)}&password=${encodeURIComponent(playlist.xtreamPassword)}&type=m3u_plus&output=ts`;
      }
      if (!fetchUrl) { onToast("Pas d'URL source", "error"); return; }

      const content = await fetchWithCorsRetry(fetchUrl);
      const parsed = parseM3U(content);
      if (parsed.length === 0) { onToast("Aucune chaîne trouvée", "error"); return; }

      // Preserve favorites
      const oldChannels = await store.getChannels(playlist.id);
      const favNames = new Set(oldChannels.filter((c) => c.isFavorite).map((c) => c.name));

      await store.deleteChannelsByPlaylist(playlist.id);
      const channels = parsed.map((ch) => ({
        playlistId: playlist.id,
        name: ch.name,
        url: ch.url,
        logo: ch.logo,
        group: ch.group || "Sans catégorie",
        tvgId: ch.tvgId,
        tvgName: ch.tvgName,
        isFavorite: favNames.has(ch.name),
      }));
      await store.addChannels(playlist.id, channels);
      await store.updatePlaylist(playlist.id, {
        channelCount: parsed.length,
        updatedAt: new Date().toISOString(),
      });

      onRefresh();
      onToast(`Mise à jour : ${parsed.length} chaînes`, "success");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Erreur", "error");
    } finally { setRefreshingId(null); }
  };

  const handleDelete = async (playlist: Playlist, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playlist.isDefault) {
      onToast("Cette playlist par défaut ne peut pas être supprimée", "error");
      return;
    }
    if (!confirm(`Supprimer "${playlist.name}" ?`)) return;
    try {
      await store.deletePlaylist(playlist.id);
      onRefresh();
      onToast(`"${playlist.name}" supprimée`, "info");
    } catch { onToast("Erreur", "error"); }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.(m3u8?|txt)$/i.test(file.name)) {
      handleAddByFile(file);
    } else {
      onToast("Format non supporté. Fichier .m3u ou .m3u8 requis", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return "À l'instant";
    if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`;
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  return (
    <div
      className="flex-1 overflow-y-auto p-4 sm:p-6"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-dark-950/80 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-accent-500 rounded-3xl p-16 text-center">
            <div className="text-6xl mb-4">📂</div>
            <p className="text-accent-400 text-xl font-medium">Déposez votre fichier M3U ici</p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1">Mes Playlists</h2>
            <p className="text-gray-500 text-sm sm:text-base">
              {playlists.length === 0
                ? "Ajoutez votre première playlist pour commencer"
                : `${playlists.length} playlist${playlists.length > 1 ? "s" : ""} • ${playlists.reduce((s, p) => s + p.channelCount, 0).toLocaleString("fr-FR")} chaînes au total`}
            </p>
            <p className="text-gray-700 text-xs mt-1">🛡️ Proxy anti-blocage intégré • 💾 Stockage local</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="focusable flex items-center justify-center gap-2 bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-600 text-white px-5 py-3 sm:py-2.5 rounded-xl transition-all font-medium shadow-lg shadow-accent-500/20 hover:shadow-accent-500/40 shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter
          </button>
        </div>

        {playlists.length === 0 ? (
          <div className="relative rounded-3xl overflow-hidden border border-dark-600/50">
            <div className="absolute inset-0 bg-gradient-to-br from-accent-600/10 via-transparent to-purple-600/5" />
            <div className="relative text-center py-12 sm:py-24 px-4 sm:px-6 slide-in-up">
              <div className="text-6xl sm:text-8xl mb-6 sm:mb-8">📡</div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3 sm:mb-4">Bienvenue sur StreamVault</h3>
              <p className="text-gray-400 mb-3 max-w-lg mx-auto text-base sm:text-lg">
                Lecteur IPTV 100% navigateur. Aucun serveur requis.
                Vos données restent sur votre appareil.
              </p>
              <div className="flex flex-wrap justify-center gap-2 sm:gap-3 text-xs text-gray-400 mb-8 sm:mb-10">
                {["M3U / M3U8", "Xtream Codes", "HLS Streams", "Anti géo-blocage", "Bypass CloudFront", "Stockage local"].map((f) => (
                  <span key={f} className="bg-dark-700/70 backdrop-blur px-3 sm:px-4 py-1.5 rounded-full border border-dark-500/50">✅ {f}</span>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
                <button
                  onClick={() => setShowAddModal(true)}
                  className="focusable bg-gradient-to-r from-accent-500 to-accent-600 text-white px-8 py-3.5 rounded-xl transition-all font-medium text-lg shadow-xl shadow-accent-500/25 hover:shadow-accent-500/50 hover:scale-105 w-full sm:w-auto"
                >
                  + Ajouter une playlist
                </button>
                <p className="hidden sm:block text-gray-600 text-sm">ou glissez un fichier .m3u ici</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {playlists.map((playlist, i) => (
              <div
                key={playlist.id}
                onClick={() => onOpen(playlist)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(playlist); } }}
                className="focusable group relative bg-dark-800 border border-dark-600/50 rounded-2xl p-4 sm:p-5 cursor-pointer card-glow transition-all hover:border-accent-500/30 fade-in"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="absolute top-3 right-3">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                    playlist.type === "xtream" ? "bg-purple-500/20 text-purple-300" : "bg-accent-500/20 text-accent-300"
                  }`}>
                    {playlist.type === "xtream" ? "XTREAM" : "M3U"}
                  </span>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-dark-600 to-dark-700 rounded-xl flex items-center justify-center group-hover:from-accent-500/20 group-hover:to-accent-600/10 transition-all shrink-0">
                    {playlist.type === "xtream" ? (
                      <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                      </svg>
                    ) : (
                      <svg className="w-7 h-7 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white group-hover:text-accent-300 transition-colors truncate text-lg">{playlist.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {playlist.isDefault && (
                        <>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-accent-500/20 text-accent-300">Par défaut</span>
                          <span className="text-gray-700">•</span>
                        </>
                      )}
                      <span className="text-xs text-gray-500">{playlist.channelCount.toLocaleString("fr-FR")} chaînes</span>
                      <span className="text-gray-700">•</span>
                      <span className="text-xs text-gray-500">{formatDate(playlist.updatedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 mt-4 pt-3 border-t border-dark-600/50">
                  {(playlist.url || playlist.type === "xtream") && (
                    <button
                      onClick={(e) => handleRefresh(playlist, e)}
                      disabled={refreshingId === playlist.id}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-accent-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-dark-600"
                    >
                      <svg className={`w-3.5 h-3.5 ${refreshingId === playlist.id ? "spinner" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {refreshingId === playlist.id ? "..." : "Rafraîchir"}
                    </button>
                  )}
                  <div className="flex-1" />
                  {!playlist.isDefault && (
                    <button
                      onClick={(e) => handleDelete(playlist, e)}
                      className="text-gray-600 hover:text-danger transition-colors p-1.5 rounded-lg hover:bg-dark-600"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => { setShowAddModal(false); resetForm(); }}>
          <div className="bg-dark-800 border border-dark-600/50 rounded-2xl w-full max-w-lg shadow-2xl slide-in-up max-h-[92dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-dark-600/50 shrink-0">
              <h3 className="text-lg font-bold text-white">Ajouter une playlist</h3>
              <button onClick={() => { setShowAddModal(false); resetForm(); }} className="focusable text-gray-500 hover:text-white transition-colors p-2 sm:p-1 rounded-lg hover:bg-dark-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div className="flex gap-1 bg-dark-700 rounded-xl p-1">
                {(["url", "file", "xtream"] as const).map((mode) => (
                  <button key={mode} onClick={() => setAddMode(mode)}
                    className={`focusable flex-1 py-2.5 sm:py-2 px-3 rounded-lg text-xs font-medium transition-all ${addMode === mode ? "bg-accent-500 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                  >
                    {mode === "url" && "🔗 URL M3U"}
                    {mode === "file" && "📁 Fichier"}
                    {mode === "xtream" && "📡 Xtream"}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wider">Nom</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder={addMode === "xtream" ? "Mon serveur IPTV" : "Ma playlist IPTV"}
                  className="w-full bg-dark-900 border border-dark-500/50 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-accent-500/50 transition-all text-sm" autoFocus />
              </div>

              {addMode === "url" && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wider">URL M3U</label>
                  <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://exemple.com/playlist.m3u"
                    className="w-full bg-dark-900 border border-dark-500/50 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-accent-500/50 transition-all text-sm" />
                </div>
              )}

              {addMode === "file" && (
                <div>
                  <input ref={fileInputRef} type="file" accept=".m3u,.m3u8,.txt" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAddByFile(f); }} />
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-dark-900 border-2 border-dashed border-dark-500/50 rounded-xl px-4 py-10 text-gray-400 hover:border-accent-500/50 hover:text-accent-400 transition-all text-center group">
                    <svg className="w-10 h-10 mx-auto mb-3 text-gray-600 group-hover:text-accent-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm">Cliquez ou glissez un fichier .m3u</span>
                  </button>
                </div>
              )}

              {addMode === "xtream" && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wider">Serveur URL</label>
                    <input type="url" value={xtreamHost} onChange={(e) => setXtreamHost(e.target.value)}
                      placeholder="http://serveur.com:8080"
                      className="w-full bg-dark-900 border border-dark-500/50 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-accent-500/50 transition-all text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wider">Identifiant</label>
                      <input type="text" value={xtreamUsername} onChange={(e) => setXtreamUsername(e.target.value)}
                        placeholder="username"
                        className="w-full bg-dark-900 border border-dark-500/50 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-accent-500/50 transition-all text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wider">Mot de passe</label>
                      <input type="password" value={xtreamPassword} onChange={(e) => setXtreamPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-dark-900 border border-dark-500/50 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-accent-500/50 transition-all text-sm" />
                    </div>
                  </div>
                </>
              )}

              {progress && (
                <div className="flex items-center gap-3 text-sm text-accent-300 bg-accent-500/10 rounded-xl px-4 py-2.5 border border-accent-500/20">
                  <svg className="w-4 h-4 spinner shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                  {progress}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 bg-danger/10 border border-danger/20 text-danger rounded-xl px-4 py-2.5 text-sm">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-4 sm:p-5 border-t border-dark-600/50 shrink-0">
              <button onClick={() => { setShowAddModal(false); resetForm(); }} className="focusable px-4 py-2.5 sm:py-2 text-gray-400 hover:text-white transition-colors text-sm">Annuler</button>
              {addMode !== "file" && (
                <button onClick={addMode === "xtream" ? handleAddByXtream : handleAddByUrl}
                  disabled={loading}
                  className="focusable flex items-center gap-2 bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 sm:py-2.5 rounded-xl transition-all font-medium text-sm shadow-lg shadow-accent-500/20">
                  {loading && <svg className="w-4 h-4 spinner" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>}
                  {loading ? "Chargement..." : addMode === "xtream" ? "Connecter" : "Ajouter"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
