// Environment shim: the same frontend runs in the Tauri webview (full powers)
// and in a plain browser during dev (no invoke, no fs). Detect once, route
// accordingly — browser dev still gets a working login via the hash fallback.

export const isTauri = "__TAURI_INTERNALS__" in window;

/** Open the system browser for the OIDC dance. */
export function openExternal(url: string) {
  if (isTauri) {
    return import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
  }
  window.open(url, "_blank");
  return Promise.resolve();
}

/**
 * Where the server should hand back the session token:
 * - Tauri: the skill-sync:// deep link (caught by the app).
 * - Browser: this app's own origin — the token lands in location.hash and
 *   App() picks it up on load.
 */
export function oauthNext() {
  return isTauri ? "skill-sync://oauth/callback" : `${location.origin}/`;
}
