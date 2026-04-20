"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const links = [
  { href: "/", label: "Chat" },
  { href: "/playground", label: "Playground" },
  { href: "/history", label: "History" },
  { href: "/usage", label: "Usage" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="topnav">
      <Link href="/" className="brand" style={{ textDecoration: "none" }}>
        MyHome
      </Link>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href ? "active" : undefined}
        >
          {l.label}
        </Link>
      ))}
      <span className="spacer" />
      <ThemeToggle />
    </nav>
  );
}
