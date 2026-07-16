import { notFound } from "next/navigation";

import { Workspace } from "@/components/workspace";
import { isLocale } from "@/lib/i18n";

export const metadata = {
  title: "SVG · Graptolite Labs",
  description: "Generate, edit, and export presentation-ready SVG diagrams."
};

interface SvgPageProps {
  params: Promise<{ locale: string }>;
}

export default async function SvgPage({ params }: SvgPageProps) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return <Workspace locale={locale} />;
}
