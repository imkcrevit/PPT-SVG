import { notFound } from "next/navigation";

import { LabDeck } from "@/features/deck/ui/lab-deck";
import { isLocale } from "@/lib/i18n";

export const metadata = {
  title: "PPT · Graptolite Labs",
  description: "Generate complete PowerPoint decks grounded in uploaded source material."
};

interface PptPageProps {
  params: Promise<{ locale: string }>;
}

export default async function PptPage({ params }: PptPageProps) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return <LabDeck initialLanguage={locale} />;
}
