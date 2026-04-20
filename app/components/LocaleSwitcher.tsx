"use client";

import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { useLocale } from "./LocaleProvider";

export default function LocaleSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      aria-label={t.locale.switch}
      title={t.locale.switch}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      style={{
        width: "auto",
        padding: "0.35rem 0.5rem",
        borderRadius: "999px",
        background: "transparent",
        fontSize: "0.85rem",
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
