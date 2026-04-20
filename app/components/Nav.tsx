"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/playground", label: "Playground" },
  { href: "/history", label: "History" },
  { href: "/usage", label: "Usage" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="topnav">
      <span className="brand">MyHome AI</span>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href ? "active" : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
