// Multi-slide "deck" model for the lab feature: a document/context is turned
// into an ordered set of slides. Text slides (cover/section/bullets) carry copy;
// diagram slides carry a compiled Figure produced by the existing semantic
// pipeline, so the same SVG/PPTX rendering is reused per slide.

import type { Figure, Locale } from "@/lib/types";

export type DeckSlide =
  | { kind: "cover"; title: string; subtitle?: string }
  | { kind: "section"; title: string; subtitle?: string }
  | { kind: "bullets"; title: string; bullets: string[] }
  | { kind: "diagram"; title: string; figure: Figure };

export interface DeckPalette {
  background: string;
  accent: string;
  text: string;
  subtext: string;
  fontFamily?: string;
}

export interface Deck {
  title: string;
  language: Locale;
  palette: DeckPalette;
  slides: DeckSlide[];
}
