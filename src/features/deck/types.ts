// Multi-slide "deck" model for the lab feature: a document/context is turned
// into an ordered set of slides. Text slides (cover/section/bullets) carry copy;
// diagram slides carry a compiled Figure produced by the existing semantic
// pipeline, so the same SVG/PPTX rendering is reused per slide.

import type { Figure, Locale } from "@/lib/types";
import type { DeckTemplate } from "./template";

export type DeckSlide =
  | { kind: "cover"; title: string; subtitle?: string }
  | { kind: "section"; title: string; subtitle?: string }
  | { kind: "toc"; title: string; items: string[] }
  | { kind: "bullets"; title: string; bullets: string[] }
  // `src` is a base64 image data URI (a user upload, or media lifted out of an
  // uploaded PPTX/DOCX), resolved server-side from the model's imageRef.
  | { kind: "image"; title: string; src: string; caption?: string }
  | { kind: "image-bullets"; title: string; src: string; bullets: string[] }
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
  /** Registered built-in style. Also retained as the fallback for uploaded templates. */
  templateId?: string;
  /** Layout derived from an uploaded .pptx template; takes precedence over templateId. */
  template?: DeckTemplate;
}
