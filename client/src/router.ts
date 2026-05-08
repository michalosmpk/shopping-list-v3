import { useEffect, useState } from "react";

// Minimal path-based router. No dependencies, plays nicely with the
// vite-plugin-pwa SPA fallback (`navigateFallback: /index.html`).
//
// Routes used by the app:
//   /                  → ListsScreen (overview of all lists)
//   /list/<listId>     → ListScreen for that list
//   /admin             → AdminScreen (gated to admins, with re-auth)
//   /share/<token>     → Guest entry point for a shared list

const NAV_EVENT = "shoppinglist:navigate";

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (window.location.pathname + window.location.search === to) return;
  if (opts.replace) {
    window.history.replaceState(null, "", to);
  } else {
    window.history.pushState(null, "", to);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useLocation(): string {
  const [path, setPath] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onChange);
    window.addEventListener(NAV_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(NAV_EVENT, onChange);
    };
  }, []);

  return path;
}

export type Route =
  | { name: "lists" }
  | { name: "list"; id: string }
  | { name: "admin" }
  | { name: "share"; token: string }
  | { name: "unknown" };

export function matchRoute(path: string): Route {
  if (path === "/" || path === "") return { name: "lists" };
  if (path === "/admin" || path === "/admin/") return { name: "admin" };
  const m = /^\/list\/([^/]+)\/?$/.exec(path);
  if (m && m[1]) return { name: "list", id: decodeURIComponent(m[1]) };
  const s = /^\/share\/([^/]+)\/?$/.exec(path);
  if (s && s[1]) return { name: "share", token: decodeURIComponent(s[1]) };
  return { name: "unknown" };
}

export function listPath(id: string): string {
  return `/list/${encodeURIComponent(id)}`;
}

export function sharePath(token: string): string {
  return `/share/${encodeURIComponent(token)}`;
}

export function shareUrl(token: string): string {
  return `${window.location.origin}${sharePath(token)}`;
}
