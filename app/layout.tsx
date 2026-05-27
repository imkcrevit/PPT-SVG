import type { Metadata } from "next";
import type { ReactNode } from "react";

import { appUrl } from "@/lib/app-url";

import "./globals.css";

export const metadata: Metadata = {
  title: "PPT-SVG",
  description: "Generate high-quality SVG visuals for presentation slides.",
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
