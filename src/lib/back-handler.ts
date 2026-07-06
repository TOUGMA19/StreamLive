// Gestionnaire "Retour" universel : couvre navigateur, WebView Android
// (Capacitor), Android TV, WebOS (LG), Tizen (Samsung) et télécommandes IR.
//
// Usage :
//   const dispose = registerBackHandler(() => { ...ferme la vue... });
//   // plus tard : dispose();
//
// Le callback DOIT retourner :
//   - true  => la vue a été fermée, on absorbe le retour
//   - false => on n'a rien à fermer, laisser le comportement natif (quitter l'app)

type BackHandler = () => boolean | Promise<boolean>;

// Clés / codes émis par les différentes plateformes pour "retour"
const BACK_KEYS = new Set([
  "Escape",
  "Backspace",
  "GoBack",
  "BrowserBack",
  "XF86Back",
]);
const BACK_KEYCODES = new Set([
  8,      // Backspace
  27,     // Escape
  10009,  // Tizen (Samsung TV) return
  461,    // WebOS (LG TV) back
  166,    // Android BACK (certaines WebView)
]);

function isInEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function registerBackHandler(handler: BackHandler): () => void {
  if (typeof window === "undefined") return () => {};

  // 1) On pousse un état bidon pour capter le "back" natif (Android hardware,
  //    geste "swipe back" iOS/PWA, touche Back de la WebView).
  try {
    window.history.pushState({ __back_guard: true }, "");
  } catch { /* ignore */ }

  let disposed = false;
  // Anti-rebond : un même appui télécommande/bouton back peut déclencher
  // plusieurs événements quasi simultanés (popstate + keydown, ou double
  // signal matériel). Sans ce garde, "un retour" pouvait fermer deux vues
  // d'un coup (ex: sortir du plein écran ET revenir à la liste).
  let lastRunAt = 0;

  const runHandler = async () => {
    if (disposed) return false;
    const now = Date.now();
    if (now - lastRunAt < 450) return true; // on absorbe sans re-exécuter
    lastRunAt = now;
    try {
      const consumed = await handler();
      return consumed !== false;
    } catch {
      return false;
    }
  };

  const onPopState = async () => {
    const consumed = await runHandler();
    if (consumed) {
      // On re-pousse l'état pour rester "prêt à intercepter" le prochain retour
      try { window.history.pushState({ __back_guard: true }, ""); } catch { /* ignore */ }
    }
  };

  const onKey = async (e: KeyboardEvent) => {
    if (isInEditable(e.target)) return;
    const matches =
      BACK_KEYS.has(e.key) ||
      BACK_KEYCODES.has(e.keyCode) ||
      BACK_KEYCODES.has((e as unknown as { which?: number }).which ?? -1);
    if (!matches) return;
    // Ne pas absorber "Backspace" en édition (déjà géré par isInEditable)
    e.preventDefault();
    e.stopPropagation();
    await runHandler();
  };

  window.addEventListener("popstate", onPopState);
  window.addEventListener("keydown", onKey, { capture: true });

  // 2) Capacitor App plugin (Android/iOS natif) — chargé dynamiquement,
  //    absent en navigateur, on ignore proprement.
  let capacitorRemove: (() => void) | null = null;
  (async () => {
    try {
      const mod = await import(/* webpackIgnore: true */ "@capacitor/app").catch(() => null);
      if (!mod || disposed) return;
      const listener = await mod.App.addListener("backButton", async () => {
        const consumed = await runHandler();
        if (!consumed) {
          try { await mod.App.exitApp(); } catch { /* ignore */ }
        }
      });
      capacitorRemove = () => { try { listener.remove(); } catch { /* ignore */ } };
    } catch { /* pas de Capacitor => OK */ }
  })();

  return () => {
    disposed = true;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
    if (capacitorRemove) capacitorRemove();
  };
}
