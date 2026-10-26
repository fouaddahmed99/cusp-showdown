import { useEffect, useState } from "react";

/**
 * Hash routing. GitHub Pages serves static files only, so a deep link like
 * /cusp-showdown/join/ABCD would 404 — but #/join/ABCD always lands on
 * index.html, which matters because a join link is the thing people paste into
 * a group chat.
 */
export type Route =
  | { name: "home" }
  | { name: "solo" }
  | { name: "settings" }
  | { name: "host" }
  | { name: "join"; code?: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  const [head, tail] = path.split("/");
  switch (head) {
    case "solo":
      return { name: "solo" };
    case "settings":
      return { name: "settings" };
    case "host":
      return { name: "host" };
    case "join":
      return tail ? { name: "join", code: tail.toUpperCase() } : { name: "join" };
    default:
      return { name: "home" };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "solo":
      return "#/solo";
    case "settings":
      return "#/settings";
    case "host":
      return "#/host";
    case "join":
      return route.code ? `#/join/${route.code}` : "#/join";
    default:
      return "#/";
  }
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (next: Route) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    else setRoute(next);
  };

  return [route, navigate];
}
