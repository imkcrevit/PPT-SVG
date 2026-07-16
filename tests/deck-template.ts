// Validates the declarative deck templates: every block obeys the JSON layout
// constraints (on-canvas, resolvable colors) and each slide kind renders to a
// Figure with no off-canvas elements. Run: npm run test:deck

import {
  DECK_TEMPLATES,
  textSlideToFigure,
  withDeckChrome,
  validateDeckTemplate,
  type DeckChromeContext
} from "@/features/deck/template";
import { buildDeckMessages } from "@/features/deck/prompts";
import type { DeckPalette, DeckSlide } from "@/features/deck/types";

const W = 1280;
const H = 720;
const palette: DeckPalette = { background: "#FFFFFF", accent: "#33B1FF", text: "#0E1E36", subtext: "#5B6B80" };

const sampleSlides: DeckSlide[] = [
  { kind: "cover", title: "申报PPT科技风优化方案", subtitle: "优化文档表现力，并保留原申报数据" },
  { kind: "section", title: "研究目标与技术路线" },
  {
    kind: "bullets",
    title: "设计院场景切入机会与创新点",
    bullets: [
      "投标频次高、体量大：全年数百项投标并行",
      "资源结构复杂：10+类人员、业绩分类细、资质层级多",
      "通用SaaS无法访问人员/业绩/资质/获奖四库",
      "现有工具偏写标，缺少是否投、怎么投决策支持",
      "场景创新：首个设计院定制化AI招投标工具",
      "方法、架构、价值创新：四维度评分+三阶段SSE流水线",
      "第七条要点用于压力测试行高与换行",
      "第八条要点（应被 maxRows 截断或压缩）"
    ]
  }
];

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.log(`FAIL  ${msg}`);
};

function offCanvas(figure: { elements: Array<Record<string, number | string>> }): number {
  return figure.elements.filter((e) => {
    if (e.type === "rect") {
      return (e.x as number) < -0.5 || (e.y as number) < -0.5 || (e.x as number) + (e.width as number) > W + 0.5 || (e.y as number) + (e.height as number) > H + 0.5;
    }
    if (e.type === "text") {
      return (e.x as number) < -0.5 || (e.y as number) < -0.5 || (e.x as number) + ((e.width as number) ?? 0) > W + 0.5;
    }
    return false;
  }).length;
}

for (const tpl of DECK_TEMPLATES) {
  const issues = validateDeckTemplate(tpl);
  if (issues.length) {
    issues.forEach((i) => fail(i));
  } else {
    console.log(`PASS  template "${tpl.id}" (${tpl.name.zh}) — JSON constraints valid`);
  }

  const ctx = (index: number): DeckChromeContext => ({ index, total: 12, deckTitle: "BIM 技术标自动生成标书的研发", language: "zh" });
  sampleSlides.forEach((slide, i) => {
    const fig = textSlideToFigure(slide, palette, ctx(i), tpl.id);
    const bad = offCanvas(fig as never);
    if (bad) fail(`${tpl.id}/${slide.kind}: ${bad} off-canvas element(s)`);
    else console.log(`PASS  ${tpl.id}/${slide.kind}: ${fig.elements.length} elements, on-canvas`);
  });

  // Diagram chrome should overlay without disturbing the diagram's own elements.
  const diagram = { canvas: { width: W, height: H, background: "#fff" }, metadata: { title: "T", description: "", skillId: "flow", language: "zh" }, elements: [{ id: "x", type: "rect", x: 100, y: 100, width: 50, height: 50, fill: "#000" }] };
  const chromed = withDeckChrome(diagram as never, palette, ctx(3), tpl.id);
  if (chromed.elements.length <= diagram.elements.length) fail(`${tpl.id}: withDeckChrome added no chrome`);
  else console.log(`PASS  ${tpl.id}/diagram-chrome: +${chromed.elements.length - diagram.elements.length} elements`);
}

// Prompt regression: uploaded image bytes must be supplied as multimodal parts
// while the JSON payload exposes only stable refs/metadata. This is what lets
// the model choose a relevant original image without leaking base64 into text.
const promptMessages = await buildDeckMessages({
  context: "【上传资料：方案.md】\n阶段一到阶段二。",
  language: "zh",
  images: [
    {
      ref: "img1",
      source: "方案.pptx · image1.png",
      width: 640,
      height: 360,
      dataUri: "data:image/png;base64,aW1hZ2U="
    }
  ]
});
const systemContent = promptMessages[0]?.content;
if (
  typeof systemContent !== "string" ||
  !systemContent.includes("这是**资料编排任务**") ||
  !systemContent.includes("## 原文引用规则") ||
  !systemContent.includes("## SVG 图表穿插与类型选择")
) {
  fail("deck prompt is missing source-grounding, verbatim-quote, or diagram-variety constraints");
} else {
  console.log("PASS  deck prompt: source-grounding + quotes + varied SVG diagrams");
}

const userContent = promptMessages[1]?.content;
if (!Array.isArray(userContent) || userContent.length !== 3) {
  fail("deck prompt did not attach the uploaded image as a labeled multimodal part");
} else {
  const payloadPart = userContent[0];
  const markerPart = userContent[1];
  const imagePart = userContent[2];
  const payload = payloadPart.type === "text" ? JSON.parse(payloadPart.text) as Record<string, unknown> : undefined;
  const availableImages = payload && Array.isArray(payload.available_images) ? payload.available_images as Array<Record<string, unknown>> : [];
  const imageMetadata = availableImages[0];
  if (
    !payload ||
    imageMetadata?.ref !== "img1" ||
    "dataUri" in (imageMetadata ?? {}) ||
    markerPart.type !== "text" ||
    !markerPart.text.includes("ref=img1") ||
    imagePart.type !== "image_url" ||
    imagePart.image_url.url !== "data:image/png;base64,aW1hZ2U="
  ) {
    fail("deck prompt image ref, metadata, and visual content are not mapped safely");
  } else {
    console.log("PASS  deck prompt: image ref maps to inspected visual content without base64 in JSON");
  }
}

if (failures) {
  console.log(`\n${failures} FAILURE(S) ❌`);
  process.exit(1);
}
console.log("\nALL DECK TEMPLATE CONSTRAINTS PASS ✅");
