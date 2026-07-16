import type { Metadata } from "next";
import type { ReactNode } from "react";

import { appUrl } from "@/lib/app-url";

import "./globals.css";

export const metadata: Metadata = {
  title: "SVG · PPT | Graptolite Labs",
  description: "Generate presentation-ready SVG diagrams and complete PowerPoint decks.",
  icons: {
    icon: [{ url: appUrl("/icon.svg"), type: "image/svg+xml" }],
    shortcut: [{ url: appUrl("/icon.svg"), type: "image/svg+xml" }]
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
