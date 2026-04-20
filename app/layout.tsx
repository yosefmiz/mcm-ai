import type { ReactNode } from "react";
import Nav from "./components/Nav";
import "./globals.css";

export const metadata = {
  title: "MyHome AI",
  description: "AI-powered real-estate contract generation",
};

// FOUC-free theme init: runs synchronously before React hydrates so the page
// paints in the right theme on first frame. Reads localStorage; falls back to
// system preference; defaults to light.
const themeInitScript = `
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
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
