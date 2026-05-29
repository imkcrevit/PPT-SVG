import JSZip from "jszip";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { figureToPptx } from "@/lib/pptx";
import type { Figure } from "@/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function shapeBlock(xml: string, objectName: string): string {
  const nameIndex = xml.indexOf(`name="${objectName}"`);
  assert(nameIndex >= 0, `missing object ${objectName}`);
  const start = xml.lastIndexOf("<p:sp>", nameIndex);
  const end = xml.indexOf("</p:sp>", nameIndex);
  assert(start >= 0 && end > start, `missing shape block for ${objectName}`);
  return xml.slice(start, end + "</p:sp>".length);
}

const figure: Figure = {
  canvas: { width: 1280, height: 720, background: "#FFFFFF" },
  metadata: { title: "PPTX export", description: "PPTX export assertions", skillId: "swimlane", language: "zh" },
  elements: [
    { id: "node-rect", type: "rect", x: 220, y: 180, width: 180, height: 70, rx: 10, fill: "#FFFFFF", stroke: "#2F6FED", strokeWidth: 2 },
    { id: "node-title", type: "text", x: 220, y: 180, width: 180, height: 70, text: "节点文字", fontSize: 18, fontWeight: 700, fill: "#1D2433", textAnchor: "middle" },
    { id: "lane-bg-0", type: "rect", x: 48, y: 320, width: 1184, height: 120, rx: 10, fill: "#EEF4FF", stroke: "none", strokeWidth: 0 },
    { id: "lane-name-0", type: "text", x: 58, y: 368, width: 116, height: 24, text: "用户", fontSize: 13, fontWeight: 700, fill: "#2F6FED", textAnchor: "start" },
    {
      id: "edge-0-connector",
      type: "connector",
      points: [
        { x: 430, y: 215 },
        { x: 560, y: 215 },
        { x: 560, y: 380 },
        { x: 720, y: 380 }
      ],
      stroke: "#52607A",
      strokeWidth: 2,
      endArrow: true
    }
  ]
};

const normalized = validateAndNormalizeFigureResponse({ figure }, "swimlane", "zh");
assert(normalized.ok && Boolean(normalized.response), "figure validation failed");
const normalizedFigure = normalized.response!.figure;
const laneName = normalizedFigure.elements.find((element) => element.id === "lane-name-0");
assert(laneName?.type === "text", "lane-name-0 missing after normalization");
assert(laneName.textAnchor === "start" && laneName.x <= 100, "lane label should remain left aligned before PPTX export");

const pptx = await figureToPptx(normalizedFigure);
const zip = await JSZip.loadAsync(pptx);
const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
const connector = shapeBlock(xml, "edge-0-connector");
const centeredText = shapeBlock(xml, "node-title");
const laneText = shapeBlock(xml, "lane-name-0");

assert(connector.includes('prst="bentConnector3"'), "folded connector should export as native bentConnector3");
assert(connector.includes('<a:tailEnd type="triangle"/>'), "folded connector should keep end arrow");
assert(!connector.includes("<a:custGeom>"), "folded connector should not use custom geometry for arrowed PPTX export");
assert(centeredText.includes('anchor="ctr"') && centeredText.includes('algn="ctr"'), "centered text should use middle vertical and center horizontal alignment");
assert(laneText.includes('anchor="ctr"') && laneText.includes('algn="l"'), "swimlane label should remain vertically centered and left aligned");

console.log("PPTX EXPORT ASSERTIONS PASS");
