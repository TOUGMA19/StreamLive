"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import type { Channel } from "@/lib/types";
import { proxyStreamUrl, prefetchSegment } from "@/lib/proxy";

interface VideoPlayerProps {
  channel: Channel;
  onNextChannel?: () => void;
  onPrevChannel?: () => void;
  onBackMobile?: () => void;
  fullscreenSignal?: number;
}

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
}

export function VideoPlayer({ channel, onNextChannel, onPrevChannel, onBackMobile, fullscreenSignal }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);
  const lastErrorRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<"contain" | "cover" | "fill">("contain");
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bufferHealth, setBufferHealth] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlaying) { setShowControls(false); setShowQualityMenu(false); }
    }, 3500);
  }, [isPlaying]);

  // ─── Load Channel avec retry intelligent ─────────────────────────────────────
  const loadStream = useCallback(async (attempt = 0) => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);
    setIsPlaying(false);
    setQualities([]);
    setCurrentQuality(-1);
    setShowQualityMenu(false);
    setRetryAttempt(attempt);
    retryCountRef.current = attempt;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const rawUrl = channel.url;
    const proxiedUrl = proxyStreamUrl(rawUrl);

    // Détection améliorée HLS
    const isHls = 
      rawUrl.includes(".m3u8") || 
      rawUrl.includes("/live/") || 
      rawUrl.includes("type=m3u_plus") || 
      rawUrl.includes("/play/") ||
      rawUrl.includes("/stream/") ||
      rawUrl.includes("hls") ||
      rawUrl.includes("playlist") ||
      rawUrl.endsWith(".m3u") ||
      rawUrl.includes("output=ts");

    try {
      if (isHls && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startFragPrefetch: true,
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: 20000,
          levelLoadingMaxRetry: 4,
          levelLoadingRetryDelay: 1000,
          levelLoadingMaxRetryTimeout: 20000,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryTimeout: 20000,
          xhrSetup: (xhr, url) => {
            xhr.withCredentials = false;
            // Injecter des headers anti-détection sur les requêtes XHR internes
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
          },
          // Configuration avancée pour bypass
          loader: class extends Hls.DefaultConfig.loader {
            load(context: any, config: any, callbacks: any) {
              // Précharger les segments suivants
              if (context.type === "manifest") {
                context.url = proxyStreamUrl(context.url);
              }
              super.load(context, config, callbacks);
            }
          } as any,
        });

        hlsRef.current = hls;
        hls.loadSource(proxiedUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          setLoading(false);
          if (data.levels && data.levels.length > 1) {
            setQualities(data.levels.map((level, index) => ({
              index, height: level.height, bitrate: level.bitrate,
            })));
          }
          video.play().then(() => setIsPlaying(true)).catch(() => {});
        });

        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (video.buffered.length > 0) {
            const buffered = video.buffered.end(0) - video.currentTime;
            setBufferHealth(Math.min(buffered, 30));
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (attempt < 3) {
                  // Retry avec délai exponentiel
                  setTimeout(() => loadStream(attempt + 1), Math.pow(2, attempt) * 1000);
                  return;
                }
                setError("Erreur réseau — Impossible de charger le flux");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setError("Erreur de lecture du flux");
                hls.destroy();
                break;
            }
            setLoading(false);
          }
        });

        // Préchargement proactif des segments
        hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
          const frag = data.frag;
          if (frag && typeof frag.sn === "number") {
            // Précharger le prochain segment
            const nextSn = frag.sn + 1;
            const level = hls.levels[hls.currentLevel];
            if (level && level.details) {
              const nextFrag = level.details.fragments.find((f: any) => f.sn === nextSn);
              if (nextFrag && nextFrag.url) {
                prefetchSegment(nextFrag.url);
              }
            }
          }
        });

      } else if (video.canPlayType("application/vnd.apple.mpegurl") && isHls) {
        // Safari native HLS
        video.src = proxiedUrl;
        video.addEventListener("loadedmetadata", () => {
          setLoading(false);
          video.play().then(() => setIsPlaying(true)).catch(() => {});
        }, { once: true });
      } else {
        // Stream direct (MP4, etc.)
        video.src = proxiedUrl;
        video.addEventListener("loadeddata", () => {
          setLoading(false);
          video.play().then(() => setIsPlaying(true)).catch(() => {});
        }, { once: true });
      }

      const onError = () => {
        if (attempt < 3) {
          setTimeout(() => loadStream(attempt + 1), Math.pow(2, attempt) * 1000);
        } else {
          setError("Impossible de lire ce flux après plusieurs tentatives");
          setLoading(false);
        }
      };
      video.addEventListener("error", onError, { once: true });

    } catch (err) {
      if (attempt < 3) {
        setTimeout(() => loadStream(attempt + 1), Math.pow(2, attempt) * 1000);
      } else {
        setError("Erreur critique lors du chargement");
        setLoading(false);
      }
    }
  }, [channel.url]);

  useEffect(() => {
    loadStream(0);
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [loadStream]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play().then(() => setIsPlaying(true)).catch(() => {}); }
    else { video.pause(); setIsPlaying(false); }
  }, []);

  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value; setVolume(value); setIsMuted(value === 0); video.muted = value === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted; setIsMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (!document.fullscreenElement) await container.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* ignore */ }
  }, []);

  // Entre en plein écran (sans basculer si déjà en plein écran) — utilisé
  // pour le double-clic sur une chaîne dans la liste.
  const enterFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container || document.fullscreenElement) return;
    try {
      await container.requestFullscreen();
    } catch { /* ignore */ }
  }, []);

  const lastFullscreenSignalRef = useRef(0);
  useEffect(() => {
    if (fullscreenSignal && fullscreenSignal !== lastFullscreenSignalRef.current) {
      lastFullscreenSignalRef.current = fullscreenSignal;
      enterFullscreen();
    }
  }, [fullscreenSignal, enterFullscreen]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); setIsPip(false); }
      else { await video.requestPictureInPicture(); setIsPip(true); }
    } catch { /* ignore */ }
  }, []);

  const cycleAspectRatio = useCallback(() => {
    setAspectRatio((prev) => prev === "contain" ? "cover" : prev === "cover" ? "fill" : "contain");
  }, []);

  const setQuality = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index; setCurrentQuality(index); setShowQualityMenu(false);
  }, []);

  const handleRetry = useCallback(() => {
    loadStream(0);
  }, [loadStream]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      switch (e.key) {
        case " ": case "k": e.preventDefault(); togglePlay(); break;
        case "f": e.preventDefault(); toggleFullscreen(); break;
        case "p": e.preventDefault(); togglePip(); break;
        case "m": e.preventDefault(); toggleMute(); break;
        case "a": e.preventDefault(); cycleAspectRatio(); break;
        case "r": e.preventDefault(); handleRetry(); break;
        case "ArrowUp":
          if (e.shiftKey && onPrevChannel) { e.preventDefault(); onPrevChannel(); }
          else { e.preventDefault(); handleVolumeChange(Math.min(1, volume + 0.1)); }
          break;
        case "ArrowDown":
          if (e.shiftKey && onNextChannel) { e.preventDefault(); onNextChannel(); }
          else { e.preventDefault(); handleVolumeChange(Math.max(0, volume - 0.1)); }
          break;
        case "?": e.preventDefault(); setShowShortcuts((s) => !s); break;
        case "Escape": setShowQualityMenu(false); setShowShortcuts(false); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, toggleFullscreen, togglePip, toggleMute, cycleAspectRatio, handleVolumeChange, volume, onNextChannel, onPrevChannel, handleRetry]);

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const aspectClass = aspectRatio === "contain" ? "object-contain" : aspectRatio === "cover" ? "object-cover" : "object-fill";

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-black relative"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => { if (isPlaying) { setShowControls(false); setShowQualityMenu(false); } }}>

      <div className="flex-1 relative flex items-center justify-center" onClick={togglePlay}>
        <video ref={videoRef} className={`w-full h-full ${aspectClass}`} playsInline autoPlay crossOrigin="anonymous" />

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-center slide-in-up">
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-dark-600" />
                <div className="absolute inset-0 rounded-full border-2 border-accent-500 border-t-transparent spinner" />
              </div>
              <p className="text-gray-300 text-sm font-medium">{channel.name}</p>
              <p className="text-gray-600 text-xs mt-1">
                {retryAttempt > 0 ? `Tentative ${retryAttempt + 1}/4...` : "Connexion au flux..."}
              </p>
              {/* Barre de buffer */}
              <div className="w-48 h-1 bg-dark-700 rounded-full mt-3 mx-auto overflow-hidden">
                <div className="h-full bg-accent-500 rounded-full transition-all duration-300" style={{ width: `${(retryAttempt / 4) * 100}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/85">
            <div className="text-center max-w-md slide-in-up">
              <div className="w-16 h-16 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-white text-lg font-medium mb-1">{error}</p>
              <p className="text-gray-500 text-sm mb-5">Le flux n&apos;est peut-être plus disponible ou bloqué.</p>
              <div className="flex items-center justify-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); handleRetry(); }}
                  className="bg-accent-500 hover:bg-accent-600 text-white px-6 py-2.5 rounded-xl transition-colors font-medium text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Réessayer
                </button>
                {onNextChannel && (
                  <button onClick={(e) => { e.stopPropagation(); onNextChannel(); }}
                    className="bg-dark-700 hover:bg-dark-600 text-white px-4 py-2.5 rounded-xl transition-colors font-medium text-sm">
                    Chaîne suivante
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Play button overlay */}
        {!isPlaying && !loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center cursor-pointer hover:bg-white/20 transition-all hover:scale-110 border border-white/10">
              <svg className="w-9 h-9 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={`absolute bottom-0 left-0 right-0 transition-all duration-300 ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>
        <div className="bg-gradient-to-t from-black via-black/80 to-transparent pt-16 pb-3 px-4">

          {/* Buffer health bar */}
          {bufferHealth > 0 && (
            <div className="w-full h-0.5 bg-dark-600/50 rounded-full mb-2 overflow-hidden">
              <div className="h-full bg-accent-500/60 rounded-full transition-all" style={{ width: `${Math.min((bufferHealth / 30) * 100, 100)}%` }} />
            </div>
          )}

          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              {onBackMobile && (
                <button onClick={(e) => { e.stopPropagation(); onBackMobile(); }} className="focusable p-2 -ml-1.5 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-white/10" title="Retour (Échap / Retour télécommande)">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-live live-dot" />
                <span className="text-[10px] font-bold text-live uppercase tracking-wider">Live</span>
              </div>
              <div className="w-px h-3 bg-gray-700" />
              <span className="text-white font-medium text-sm">{channel.name}</span>
              <span className="text-gray-500 text-xs">{channel.group}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-success/30 bg-success/10 text-success">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Proxy anti-blocage
              </span>
              {bufferHealth > 0 && (
                <span className="text-accent-400">{bufferHealth.toFixed(1)}s buffer</span>
              )}
              <kbd>?</kbd> <span>aide</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onPrevChannel && (
              <button onClick={(e) => { e.stopPropagation(); onPrevChannel(); }} className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5" title="Chaîne précédente (Shift+↑)">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
            )}

            <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="p-2 text-white hover:text-accent-300 transition-colors rounded-lg hover:bg-white/5" title="Lecture/Pause">
              {isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>

            {onNextChannel && (
              <button onClick={(e) => { e.stopPropagation(); onNextChannel(); }} className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5" title="Chaîne suivante (Shift+↓)">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            )}

            <div className="w-px h-4 bg-gray-800 mx-1" />

            <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5" title="Muet (M)">
              {isMuted || volume === 0 ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
              )}
            </button>
            <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
              onChange={(e) => { e.stopPropagation(); handleVolumeChange(parseFloat(e.target.value)); }}
              onClick={(e) => e.stopPropagation()} className="w-20" />

            <div className="flex-1" />

            {qualities.length > 0 && (
              <div className="relative">
                <button onClick={(e) => { e.stopPropagation(); setShowQualityMenu(!showQualityMenu); }}
                  className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5 text-xs font-medium" title="Qualité">
                  {currentQuality === -1 ? "AUTO" : `${qualities.find((q) => q.index === currentQuality)?.height || "?"}p`}
                </button>
                {showQualityMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-dark-800 border border-dark-500 rounded-xl overflow-hidden shadow-2xl min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setQuality(-1)}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-dark-600 transition-colors ${currentQuality === -1 ? "text-accent-300 bg-accent-500/10" : "text-gray-300"}`}>Auto</button>
                    {qualities.sort((a, b) => b.height - a.height).map((q) => (
                      <button key={q.index} onClick={() => setQuality(q.index)}
                        className={`w-full text-left px-4 py-2 text-xs hover:bg-dark-600 transition-colors ${currentQuality === q.index ? "text-accent-300 bg-accent-500/10" : "text-gray-300"}`}>
                        {q.height}p <span className="text-gray-600 ml-2">{Math.round(q.bitrate / 1000)}k</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={(e) => { e.stopPropagation(); cycleAspectRatio(); }}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5" title={`Ratio: ${aspectRatio} (A)`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>

            <button onClick={(e) => { e.stopPropagation(); togglePip(); }}
              className={`p-2 transition-colors rounded-lg hover:bg-white/5 ${isPip ? "text-accent-300" : "text-gray-400 hover:text-white"}`} title="Picture-in-Picture (P)">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </button>

            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5" title="Plein écran (F)">
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Shortcuts modal */}
      {showShortcuts && (
        <div className="absolute inset-0 bg-black/85 flex items-center justify-center z-50" onClick={() => setShowShortcuts(false)}>
          <div className="glass border border-dark-500 rounded-2xl p-6 max-w-sm w-full slide-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Raccourcis clavier</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-gray-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {[["Espace / K","Lecture / Pause"],["F","Plein écran"],["P","Picture-in-Picture"],["M","Muet / Son"],["A","Changer le ratio"],["R","Réessayer le flux"],["↑ / ↓","Volume +/-"],["Shift + ↑","Chaîne précédente"],["Shift + ↓","Chaîne suivante"],["⌘K","Rechercher"],["?","Afficher raccourcis"]].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-gray-400">{desc}</span>
                  <kbd className="text-xs">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
