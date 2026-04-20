"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import LocaleSwitcher from "./LocaleSwitcher";
import { useT } from "./LocaleProvider";

export default function Nav() {
  const pathname = usePathname();
  const t = useT();

  const links = [
    { href: "/", label: t.nav.chat },
    { href: "/playground", label: t.nav.playground },
    { href: "/history", label: t.nav.history },
    { href: "/usage", label: t.nav.usage },
  ];

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
      <LocaleSwitcher />
      <ThemeToggle />
    </nav>
  );
}
