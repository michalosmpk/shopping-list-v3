import { useEffect, useState } from "react";

// Minimal path-based router. No dependencies, plays nicely with the
// vite-plugin-pwa SPA fallback (`navigateFallback: /index.html`).
//
// Routes used by the app:
//   /              → ListsScreen (overview of all lists)
//   /list/<listId> → ListScreen for that list
// Anything else falls through to the overview.

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
  | { name: "unknown" };

export function matchRoute(path: string): Route {
  if (path === "/" || path === "") return { name: "lists" };
  const m = /^\/list\/([^/]+)\/?$/.exec(path);
  if (m && m[1]) return { name: "list", id: decodeURIComponent(m[1]) };
  return { name: "unknown" };
}

export function listPath(id: string): string {
  return `/list/${encodeURIComponent(id)}`;
}
