import { LOCALES, type Locale } from "@/lib/types";

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

export const dictionaries = {
  en: {
    appName: "PPT-SVG",
    appSubtitle: "Simple SVG diagrams for presentation slides.",
    languageEnglish: "EN",
    languageChinese: "中文",
    skillLabel: "Diagram type",
    modelLabel: "Model",
    modelFromEnv: "From environment",
    promptLabel: "Describe the diagram",
    promptPlaceholder: "Example: Show a 5-step customer onboarding workflow from signup to renewal.",
    pptLabel: "PPTX context",
    pptIdle: "Drop or select a .pptx file",
    pptReady: "Selected",
    invalidPpt: "Choose a .pptx file.",
    generate: "Generate",
    generating: "Generating",
    generateQueued: "Sending request to the generation API...",
    generateThinking: "AI thinking...",
    generateRendering: "Rendering generated SVG...",
    downloadSvg: "Download SVG",
    preview: "Preview",
    json: "JSON",
    fit: "Fit",
    emptyState: "Generate a diagram to preview it here.",
    errorTitle: "Generation failed",
    emptyPrompt: "Enter a short diagram description first.",
    selectedElement: "Selected element",
    noSelection: "Select an SVG element to edit it.",
    text: "Text",
    fill: "Fill",
    stroke: "Stroke",
    undo: "Undo",
    pptxDisabled: "PPTX export is disabled in the UI for V1."
  },
  zh: {
    appName: "PPT-SVG",
    appSubtitle: "以简洁为主，生成适合演示文稿的 SVG 图形。",
    languageEnglish: "EN",
    languageChinese: "中文",
    skillLabel: "图形类型",
    modelLabel: "模型",
    modelFromEnv: "来自环境变量",
    promptLabel: "描述图形",
    promptPlaceholder: "示例：生成一个从注册到续费的 5 步客户 onboarding 流程图。",
    pptLabel: "PPTX 上下文",
    pptIdle: "拖入或选择 .pptx 文件",
    pptReady: "已选择",
    invalidPpt: "请选择 .pptx 文件。",
    generate: "生成",
    generating: "生成中",
    generateQueued: "正在请求生成接口...",
    generateThinking: "AI 正在思考...",
    generateRendering: "正在渲染生成的 SVG...",
    downloadSvg: "下载 SVG",
    preview: "预览",
    json: "JSON",
    fit: "匹配度",
    emptyState: "生成图形后会在这里预览。",
    errorTitle: "生成失败",
    emptyPrompt: "请先输入简短的图形描述。",
    selectedElement: "选中元素",
    noSelection: "选择一个 SVG 元素后可编辑。",
    text: "文本",
    fill: "填充",
    stroke: "描边",
    undo: "撤销",
    pptxDisabled: "V1 暂不在 UI 中启用 PPTX 导出。"
  }
} satisfies Record<Locale, Record<string, string>>;

export type Dictionary = (typeof dictionaries)[Locale];
