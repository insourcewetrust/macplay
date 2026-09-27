import { useEffect, useState } from "react";

export function useRoute(): string[] {
  const get = () => (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => {
      setR(get());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const go = (path: string) => {
  location.hash = path.startsWith("/") ? path : "/" + path;
};
