import type pptxgen from "pptxgenjs";

import type { Deck, DeckPalette, DeckSlide } from "@/lib/deck-types";
import { addFigureSlide, createDeck, pptxColor, writeDeck } from "@/lib/pptx";
import { pickReadableText } from "@/lib/theme";

const W = 13.333;

// Compile a Deck into a multi-slide PPTX. Diagram slides reuse the existing
// figure renderer; text slides are laid out here with the deck palette.
export async function deckToPptx(deck: Deck): Promise<Buffer> {
  const pptx = createDeck({ title: deck.title, fontFamily: deck.palette.fontFamily });
  for (const slide of deck.slides) {
    addDeckSlide(pptx, slide, deck.palette);
  }
  return writeDeck(pptx);
}

function addDeckSlide(pptx: pptxgen, slide: DeckSlide, palette: DeckPalette): void {
  if (slide.kind === "diagram") {
    addFigureSlide(pptx, slide.figure);
    return;
  }

  const font = palette.fontFamily;
  const s = pptx.addSlide();

  if (slide.kind === "cover") {
    s.background = { color: pptxColor(palette.background) };
    s.addShape("rect" as pptxgen.ShapeType, { x: 0.9, y: 4.35, w: 2.2, h: 0.12, fill: { color: pptxColor(palette.accent) }, line: { transparency: 100, color: pptxColor(palette.accent) } });
    s.addText(slide.title, { x: 0.9, y: 2.6, w: W - 1.8, h: 1.6, fontFace: font, fontSize: 40, bold: true, color: pptxColor(palette.text), align: "left", valign: "bottom" });
    if (slide.subtitle) {
      s.addText(slide.subtitle, { x: 0.9, y: 4.65, w: W - 1.8, h: 1.2, fontFace: font, fontSize: 20, color: pptxColor(palette.subtext), align: "left", valign: "top" });
    }
    return;
  }

  if (slide.kind === "section") {
    const readable = pickReadableText(palette.accent);
    s.background = { color: pptxColor(palette.accent) };
    s.addText(slide.title, { x: 1, y: 2.9, w: W - 2, h: 1.5, fontFace: font, fontSize: 34, bold: true, color: pptxColor(readable), align: "center", valign: "middle" });
    if (slide.subtitle) {
      s.addText(slide.subtitle, { x: 1, y: 4.4, w: W - 2, h: 0.9, fontFace: font, fontSize: 18, color: pptxColor(readable), align: "center", valign: "top", transparency: 15 });
    }
    return;
  }

  // bullets
  s.background = { color: pptxColor(palette.background) };
  s.addText(slide.title, { x: 0.9, y: 0.55, w: W - 1.8, h: 1.0, fontFace: font, fontSize: 28, bold: true, color: pptxColor(palette.text), align: "left", valign: "middle" });
  s.addShape("rect" as pptxgen.ShapeType, { x: 0.92, y: 1.55, w: 3.0, h: 0.05, fill: { color: pptxColor(palette.accent) }, line: { transparency: 100, color: pptxColor(palette.accent) } });

  const runs: pptxgen.TextProps[] = slide.bullets.slice(0, 8).map((text) => ({
    text,
    options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 10 }
  }));
  s.addText(runs.length ? runs : [{ text: "" }], {
    x: 1.0,
    y: 1.9,
    w: W - 2,
    h: 5.0,
    fontFace: font,
    fontSize: 18,
    color: pptxColor(palette.text),
    align: "left",
    valign: "top"
  });
}
