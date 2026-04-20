import type { ReactNode } from "react";
import Nav from "./components/Nav";
import { LocaleProvider } from "./components/LocaleProvider";
import "./globals.css";

export const metadata = {
  title: "MyHome AI",
  description: "AI-powered real-estate contract generation",
};

// FOUC-free init: runs synchronously before React hydrates so the page
// paints with the right theme + locale on first frame.
const initScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  try {
    var supported = ['en','he','ru','ar'];
    var l = localStorage.getItem('locale');
    if (supported.indexOf(l) < 0) {
      var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
      l = supported.indexOf(nav) >= 0 ? nav : 'en';
    }
    var rtl = (l === 'he' || l === 'ar') ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', l);
    document.documentElement.setAttribute('dir', rtl);
  } catch (e) {
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('dir', 'ltr');
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>
        <LocaleProvider>
          <Nav />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
