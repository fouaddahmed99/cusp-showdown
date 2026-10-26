/**
 * Everything the app fetches has to go through the GitHub Pages base path, so
 * a project site served from /cusp-showdown/ resolves its own content.
 */
export const BASE_URL: string = import.meta.env.BASE_URL ?? "/";

export function asset(relative: string): string {
  const trimmed = relative.replace(/^\/+/, "");
  return `${BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`}${trimmed}`;
}

/** Absolute URL for a shareable room link. */
export function absoluteUrl(relative: string): string {
  if (typeof window === "undefined") return asset(relative);
  return new URL(asset(relative), window.location.origin).toString();
}
