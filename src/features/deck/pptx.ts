import { addFigureSlide, createDeck, writeDeck } from "@/features/svg";

import { textSlideToFigure, withDeckChrome, type DeckChromeContext } from "./template";
import type { Deck } from "./types";

// Compile a Deck into a multi-slide PPTX. Every slide — text or diagram — is
// turned into a Figure (text slides via the tech-blue template, diagram slides
// with a page-number footer) and rendered through the shared figure exporter,
// so the PPTX matches the on-screen preview exactly.
export async function deckToPptx(deck: Deck): Promise<Buffer> {
  const pptx = createDeck({ title: deck.title, fontFamily: deck.palette.fontFamily });
  deck.slides.forEach((slide, index) => {
    const ctx: DeckChromeContext = {
      index,
      total: deck.slides.length,
      deckTitle: deck.title,
      language: deck.language
    };
    const figure =
      slide.kind === "diagram"
        ? withDeckChrome(slide.figure, deck.palette, ctx)
        : textSlideToFigure(slide, deck.palette, ctx);
    addFigureSlide(pptx, figure);
  });
  return writeDeck(pptx);
}
