"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import LocaleSwitcher from "./LocaleSwitcher";

export default function Nav() {
  return (
    <nav className="topnav">
      <Link href="/" className="brand" style={{ textDecoration: "none" }}>
        MyHome
      </Link>
      <span className="muted" style={{ fontSize: "0.8rem" }}>
        Local test sandbox
      </span>
      <span className="spacer" />
      <LocaleSwitcher />
      <ThemeToggle />
    </nav>
  );
}
