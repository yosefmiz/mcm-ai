import type { ReactNode } from "react";
import Nav from "./components/Nav";
import "./globals.css";

export const metadata = {
  title: "MyHome AI",
  description: "AI-powered real-estate contract generation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
