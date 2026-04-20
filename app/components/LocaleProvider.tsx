"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_LOCALE,
  dirFor,
  isLocale,
  messages,
  type Locale,
  type T,
} from "@/lib/i18n";

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: T;
}

const LocaleCtx = createContext<Ctx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // hydrate from html attribute (set by FOUC-free init script in <head>)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const v = document.documentElement.getAttribute("lang");
    if (isLocale(v)) setLocaleState(v);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    document.documentElement.setAttribute("lang", l);
    document.documentElement.setAttribute("dir", dirFor(l));
    try {
      localStorage.setItem("locale", l);
      document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
    setLocaleState(l);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ locale, setLocale, t: messages[locale] }),
    [locale, setLocale],
  );

  return <LocaleCtx.Provider value={value}>{children}</LocaleCtx.Provider>;
}

export function useLocale(): Ctx {
  const ctx = useContext(LocaleCtx);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

export function useT(): T {
  return useLocale().t;
}
