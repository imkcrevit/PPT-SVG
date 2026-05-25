# Project SOP / 设计文档

> 项目代号:待定(候选:`slidekit` / `pptkit` / `svgpaste` / `vector-deck`)
> 文档版本:v0.1 · 初始设计共识
> 文档性质:可演进的内部规范

---

## 1. 项目定位

**一句话定义**
面向 PPT 视觉素材的 Skills 框架——用户输入提示词(或上传 PPT 上下文),由 LLM 生成结构化 JSON,本地代码渲染成**高精度 SVG** 与 **原生形状 PPTX** 双输出。

**项目性质**
- 开源框架(协议:Apache-2.0)
- 个人开源专项,与 `revit-api-rag` / `PromptBridge` 同一系列
- 不开放公网,内部部署 + 别人 fork 自托管
- 内部部署费用由作者承担,fork 用户自负

**与现有项目的差异化**
- 不是 AI PPT 生成器(Gamma / Canva / Slidesgo 那类全流程工具)
- 不是通用 SVG 生成器(VectoSolve / SVG Genie 那类)
- **核心定位**:用户已有 PPT 方案,缺一张高质量的图

---

## 2. 产品哲学(七条核心原则)

1. **约束即质量**——工具的功能边界不是用户能做什么,而是导出结果一定是高质量的
2. **Session-less**——没有账户、没有持久化、关页面即丢,零数据债务
3. **简单改或全部放弃**——用户只做轻微调整,不精修;大改交给 AI 重新生成
4. **LLM 复核而非计算**——信任 LLM 的判断,程序只做兜底校验
5. **透明而非强制**——给提示,不打断;给选择,不替用户决定
6. **80 分起点**——AI 提供 80 分图,后 20% 留给用户(网页内或 PPT 端)
7. **不做 web 版 PPT**——克制功能,专注"生成单张图"

---

## 3. 目标用户与应用场景

**用户画像**
- 主要地区:美国、澳大利亚
- 知道 AI 工具,会用 AI 对话
- 不愿为新工具单独注册或付费
- 平均停留时间预计 30 秒 – 5 分钟
- 主要 PPT 软件:PowerPoint(WPS 不在主要兼容目标内)

**典型场景**
- 已经在做一份 PPT,某一页需要流程图 / 矩阵图 / 时间线
- 不希望工具改写整份 PPT,只要单图
- 网络/耐心有限,愿意接受 SVG 的小问题以换取轻量

**不服务的场景**
- "帮我生成一整套 PPT" → 用 Gamma / Canva
- "我要精细排版一张设计图" → 用 Figma
- "我要协作编辑" → 不在产品范围内

---

## 4. 核心架构

### 4.1 数据流

```
用户输入(描述 + 可选 PPT 上下文 + 选定 Skill)
   ↓
LLM 调用(模型适配层)
   ↓
JSON 中间表示(单一可信源,符合 Skill schema)
   ↓
本地渲染器(双输出)
   ├─→ SVG(浏览器实时预览 + 下载)
   └─→ DrawingML → .pptx(下载时按需合成)
```

**关键设计:JSON 是 source of truth**
- 用户在网页上的任何编辑 = 改 JSON
- SVG 是 JSON 的实时投影
- PPTX 是 JSON 的导出快照
- 模型切换、渲染器升级,JSON schema 不动

### 4.2 模型选型

| 用途 | 推荐 | 备选 | 单次成本(粗估) |
|---|---|---|---|
| 主生成 | **Claude Haiku 4.5** | Gemini 2.5 Flash / GPT-5 mini | ≈ $0.002 |
| Skill 危险性检测 | Haiku 4.5(同模型) | — | ≈ $0.001 |
| 局部 AI 修改 | Haiku 4.5 | — | ≈ $0.001 |

**多模型适配器(`ModelAdapter` 接口)**
作为开源框架的必要能力,允许 fork 用户切换 OpenAI / Anthropic / Gemini / DeepSeek / 自部署模型。`.env` 一行切换。

### 4.3 技术栈

- **前端 + 后端**:Next.js 14(App Router),单一 repo
- **PPTX 生成**:pptxgenjs(Node 端,TS API 友好)
- **SVG 渲染**:React 组件递归渲染 JSON 树,每个节点挂 `data-node-id`
- **PPT 解析**:浏览器端 JSZip 解压 + XML 解析,**文件不离开用户机器**
- **部署**:Hetzner CCX13 / 任意单机,docker-compose 一键起

---

## 5. Skills 体系

### 5.1 SKILL.md 单文件格式

一个 skill = 一个自包含的 markdown 文件:

```markdown
---
name: project-flow
version: 1.0.0
author: lanhui
type: declarative
license: MIT
---

# Project Flow Skill
[描述]

## Capabilities
[canvas / 约束 / 编辑能力声明]

## Schema
[JSON Schema,约束 LLM 输出]

## Prompt
[Flexible input prompt 模板]

## Renderer
[声明式渲染 spec,YAML 或简化 DSL]

## Examples
[few-shot 样本]
```

**关键:Flexible Input Prompt**
所有 skill 的 prompt 模板必须显式声明它接受:
- `user_description`(文字描述)
- `ppt_context`(slide_title / slide_content / surrounding_slides)
- `user_directive`(显式指令)

并定义输入冲突时的优先级、输入缺失时的 fallback。

### 5.2 Skill 加载入口(四种)

主页面提供四种平等的入口:

| 入口 | 说明 |
|---|---|
| **内置 skills** | 工具自带,5-7 个 |
| **上传 SKILL.md** | 用户选择本地 .md 文件,默认入口 |
| **GitHub URL** | 粘贴 `github.com/...` 或 raw URL,工具自动 fetch |
| **AI 创建** | 用户描述需求,Claude 生成 .md,当前 session 立即使用 |

**Session-less**:加载的 skill 不保留,关页面即丢。下次需要再上传/拉取。

### 5.3 内置 Skills 清单(初定 5-7 个)

- `flow` — 横向/纵向流程图
- `matrix` — 2x2 / 3x3 / 四象限矩阵
- `timeline` — 横向时间线
- `pyramid` — 金字塔 / 漏斗 / 分层
- `architecture` — 分层架构图
- `concept-map` — 概念关系图
- `icon` — 单图标(可能并入其他)

每个内置 skill 必须用同一份 SKILL.md 标准实现,验证标准是否够用(dogfooding)。

### 5.4 AI 创建 / 修改 Skill

**创建**
- 用户描述想要的图类型
- Claude 生成完整 SKILL.md
- 生成后立即加载使用
- 用户可下载 .md 自己保存(本地、邮件、Notion、随便哪里)

**修改**
- 用户对当前已加载的 skill 提调整指令(如"label 字数限制太严")
- Claude 输出 JSON Patch
- 当前 session 立即生效
- 可下载更新后的 .md

**与"AI 修改图"复用同一套 prompt-to-patch 机制**,代码不重复。

### 5.5 Skill 安全:LLM 危险性检测

加载第三方 SKILL.md 时,固定 system prompt 让 Haiku 4.5 当 inspector,检测:

- Prompt injection 尝试
- 可疑 URL 或外部资源
- PII 提取倾向
- 渲染器中的可执行代码模式

输出严格 JSON `{safe, risk_level, issues, recommendation}`。

- `safe + load` → 直接加载
- `safe + warn` → 加载并显示轻提示
- `block` → 拒绝加载

**配合声明式 renderer(无 JS 执行),即使检测漏判,攻击面也极小**。

---

## 6. 用户交互流程

### 6.1 主页面

```
┌──────────────────────────────────────────────┐
│  [Skill ▾]  project-flow                     │
│                                              │
│  [Describe your diagram...]                  │
│                                              │
│  📎 Drop a .pptx for context (optional)      │
│                                              │
│                          [Generate ↻]         │
└──────────────────────────────────────────────┘
```

**核心动作只有一个:Generate。**

### 6.2 PPT 上下文(可选)

用户上传 .pptx → 浏览器端解析:

```
📎 quarterly-review.pptx  ✓ parsed (12 slides)

Detected context:
  ✦ Slide 5: "Q3 Release Plan" — looks like a flow
  ✦ Slide 8: "Customer Segments" — looks like a matrix
  ✦ Slide 12: "Roadmap" — looks like a timeline

[Generate using Slide 5 context]  [Or describe manually]
```

没传 PPT,这块不出现。

### 6.3 三档编辑

| 档位 | 触发 | 是否调 LLM |
|---|---|---|
| **L1 本地编辑** | 点击/拖拽,直接改 JSON 叶子 | ❌ |
| **L2 AI 协助** | 选中元素 + Cmd+K + 指令 | ✅ 局部 patch |
| **L3 AI 全量** | "重新生成"按钮 | ✅ 全新 JSON |

UI 视觉权重:**L1 即点即改 > L2 浮动工具条 > L3 大按钮**。

### 6.4 Cursor 风格交互

- 没有"生成完成"这个终态——结果即编辑环境
- 选中元素浮出工具条(改色 / 改字 / AI 微调)
- AI 修改用 inline diff 流式展示,可接受/拒绝
- 撤销保留最近 3 步即可(用户不会精修到第 30 步)

### 6.5 Fit 评估(LLM 透明输出)

LLM 生成 figure JSON 时可选附带:

```json
{
  "figure": { ... },
  "fit": {
    "score": 0.4,
    "note": "This content reads more like a timeline than a flow."
  }
}
```

前端处理:
- `score > 0.7` 或缺失 → 不显示
- `0.4 – 0.7` → 小提示("Consider trying [other-skill]")
- `< 0.4` → 提示更明显,**但仍然渲染**

---

## 7. 输出与兼容性

### 7.1 双输出按钮(并列)

```
[📥 Download SVG]      [📥 Download PPTX]
 light · vector         editable · larger
```

- **SVG**:用户接受 PPT 兼容性的小问题(箭头变直线等),换取轻量、即时下载
- **PPTX**:完美兼容、可编辑,但更大、需要 PowerPoint/Keynote 打开
- 下载是用户选择,不替用户决定

### 7.2 SVG 高精度承诺(七条红线)

工具承诺:**始终输出高精度 SVG**,无开关,无降级。具体规则:

| 红线 | 反例 | 正例 |
|---|---|---|
| 用矢量原语 | path-everything | `<rect>` / `<circle>` / `<line>` |
| 保留分组语义 | 扁平结构 | `<g id="step-1">` 包语义元素 |
| 保留文字 | 转 outline path | `<text>` + font-family fallback |
| 保留 defs | inline 化所有 gradient | `<defs>` 集中 + `<use>` 引用 |
| 不破坏精度 | 数值整数化 | 保留 2-3 位小数 |
| 不丢 metadata | 删除 `<title>`/`<desc>` | 顶部 `<metadata>` 写 skill 信息 |
| 无 raster 嵌入 | `<image>` 嵌 PNG | 完全矢量 |

可写成 lint 工具,渲染后自检,CI 强制。

### 7.3 PPTX:DrawingML 主路径(解决箭头问题)

**不走 SVG → PPT 转换路径**,直接生成原生 DrawingML:

- 箭头用 `<p:cxnSp>` 原生连接器,而非 `<a:line>` + marker
- 连接器声明 `<a:stCxn>` / `<a:endCxn>`,**用户在 PPT 拖动形状时箭头自动跟随**
- 文字框用 `<a:bodyPr autoFit="normAutofit">`,PPT 端自动适配
- 形状命名规范化(`Step 1 Text` 而非 `Shape 47`),便于人工微调

### 7.4 兼容性优先级

| 目标软件 | 优先级 | 路径 |
|---|---|---|
| **PowerPoint 2016+** | 主目标 | .pptx 直接打开 |
| **Google Slides** | 第二目标 | File → Import Slides 导入 .pptx(SVG 不原生支持) |
| **Keynote** | 第三目标 | .pptx 兼容打开 |
| WPS | 不主推 | .pptx 兼容,SVG 弱 |

### 7.5 画布尺寸

| 规格 | inches | EMU | SVG viewBox |
|---|---|---|---|
| 16:9(默认) | 13.33 × 7.5 | 12192000 × 6858000 | 0 0 1280 720 |
| 4:3 | 10 × 7.5 | 9144000 × 6858000 | 0 0 960 720 |
| 1:1 | 7.5 × 7.5 | 6858000 × 6858000 | 0 0 720 720 |
| 自定义 | 用户输入 | 计算转换 | 计算转换 |

切换尺寸时弹出确认("可能重新布局")。

### 7.6 V1 输出范围

- **默认下载单页 PPTX**——一张幻灯片,一个图
- JSON schema 预留 `pages: []` 数组,V1 强制 length === 1
- 多页延后

---

## 8. 视觉与样式系统

### 8.1 调色板

- **内置预设**:8-12 个高质量调色板(扁平 / 商务 / 学术 / 深色 / 等)
- **Hex 主色输入**:用户输入一个品牌主色,系统按 HSL 规则自动生成 5 色调色板(主 / 强调 / 辅助 / 警告 / 中性)
- **Advanced 切换**:允许逐个改 5 个颜色
- **不支持上传**(.pptx 主题解析放在未来阶段)

参考 Tailwind / Radix Colors 的开源调色规则。

### 8.2 字体策略

- 英文默认:Inter / Roboto(SIL OFL,可嵌入)
- 中文默认:Source Han Sans / Noto Sans CJK(OFL,可嵌入)
- 避免嵌入版权字体(微软雅黑、Calibri 等)
- PPTX 输出嵌入子集,保证用户机器没装字体也能正常显示

### 8.3 字体复核机制(不计算)

**范式**:信任 LLM 在生成时已经控字数,渲染后只做兜底校验。

- 客户端用 SVG `getBBox()` 检测溢出
- 溢出时元素右上角显示橙点(hover 提示)
- **不自动 retry,不强制处理**——用户决定:改字、AI 微调、忽略
- 实现成本极低(< 50 行代码)

### 8.4 Skill Capability Manifest

每个 skill 显式声明:

```yaml
canvas:
  ratios: [16:9, 4:3, 1:1]
  default: 16:9

constraints:
  steps:
    min: 2
    max: 8
    label_max_chars: { en: 12, zh: 6 }

operations:
  user_local: [edit_text, change_color, move_within_grid, resize]
  ai_assisted: [rewrite_label, suggest_icon, reorder]
  ai_required: [add_step, remove_step, change_direction]
  forbidden: [disconnect_arrow, delete_endpoint]
```

这份声明同时被三方读:
- 前端(决定 UI 暴露的按钮)
- LLM prompt(告诉模型能做什么)
- 校验层(用户/AI 修改提交后过约束)

---

## 9. 安全与隐私

### 9.1 浏览器端 PPT 解析

- `.pptx` 文件用 JSZip 在浏览器解压
- 只把提取的文字(几 KB)发给 LLM
- **完整 PPT 永远不离开用户机器**
- README 顶部承诺:"Your file never leaves your browser"

### 9.2 Skill 安全多层防御

| 层 | 防御内容 |
|---|---|
| L1 | 声明式 renderer 默认,无 JS 执行能力 |
| L2 | 加载时 LLM 危险性检测 |
| L3 | LLM 输出经 JSON Schema 强约束验证 |
| L4 | System / User message 严格隔离,防 prompt injection |

第 3 层是最硬的兜底:**输出不符合 schema 直接拒绝渲染**,无论 prompt 怎么被改。

### 9.3 数据零债务

- 无账户系统
- 无 session 持久化
- 无服务端用户数据存储
- 无 GDPR / CCPA 合规负担
- 内部部署时合规审查简化

---

## 10. 开源策略

### 10.1 协议

**Apache-2.0**——与 tldraw v2、`revit-api-rag` 系列协议一致;比 MIT 多显式专利授权。

### 10.2 文档分层

| 文档 | 受众 | 语言 |
|---|---|---|
| `README.md` | GitHub 访客 | 英文(主) |
| `README.zh-CN.md` | 中文圈 | 中文 |
| `docs/` | 想深入的开发者 | 英文,涵盖 architecture / skill format / self-host |

### 10.3 Self-Host 友好

- 不硬编码作者 API key
- 不依赖作者部署的服务
- `.env.example` 完整且有注释
- `docker compose up` 一行起
- 多模型 adapter 让 fork 用户自由选择 provider

### 10.4 README 招牌承诺(展示重点)

- "LLM-as-engine, not LLM-as-everything" — JSON 中间表示 + 代码渲染
- "Your file never leaves your browser" — 浏览器端 PPT 解析
- "$X to demo all day" — 透明成本表格
- "Skills as files, not as platforms" — SKILL.md 单文件分发

---

## 11. 边界(明确不做)

为了项目可持续,明确划出不做的事:

- ❌ 不是 web 版 PPT 编辑器
- ❌ 不做账户系统
- ❌ 不做协作功能
- ❌ 不做版本历史(超出"最近 3 步撤销")
- ❌ 不做 Skill marketplace / registry
- ❌ 不做 Skill 之间的依赖 / composition(V1)
- ❌ 不做整套 PPT 生成
- ❌ 不做多模态(读 PPT 里的现有图,V1 不做)
- ❌ 不做强制 fit 判断,不替用户决定
- ❌ 不做"自动 retry"——LLM 出错让用户决定怎么办
- ❌ 不做精修向工具(钢笔工具、贝塞尔编辑器等)
- ❌ 不做.pptx 主题色自动提取(V1)
- ❌ 不为 WPS / 小程序 / 微信 单独优化

---

## 12. 待决策事项

需要在后续阶段明确:

| 项 | 备注 |
|---|---|
| **项目名** | 候选:slidekit / pptkit / svgpaste / vector-deck |
| **内置 skill 起始集** | 哪 1-2 个先做,作为 V1 验证 |
| **声明式 renderer DSL** | Vega-Lite 子集 / 自定义 mini-DSL |
| **AI 创建 skill 的 prompt 模板** | 套用 flexible input 骨架的具体写法 |
| **内测渠道** | TYDI / Nexsys / Expert Elite / AECTech |
| **遥测策略** | 仅事件类型 + 时间戳,无内容 |
| **未来阶段** | 上传样板自动识别"内容空间"(V2) |

---

## 13. 关键术语

- **Skill** — 一份 SKILL.md 文件,定义一类图的 schema + prompt + renderer + capability
- **Figure** — 由 skill 生成的一张图的 JSON 实例
- **JSON Patch** — RFC 6902 标准,描述 JSON 的局部修改
- **DrawingML** — OOXML 中描述 PPT 形状的 XML 语言
- **EMU** — English Metric Unit,OOXML 内部长度单位(1 inch = 914400 EMU)
- **Capability Manifest** — Skill 声明的能力清单,前端 / LLM / 校验层共读
- **Fit Score** — LLM 对"当前 skill 是否适合输入内容"的自评

---

## 附录:决策溯源

本文档基于 10+ 轮设计推敲,关键转折点:

1. 用户画像从"通用 PPT 用户"收敛到"美澳、知 AI、不付费"
2. 输出策略从"SVG 优先"翻转到"PPTX + SVG 并列,DrawingML 主路径"
3. Skill 从"内置功能"开放到"任意 .md 文件,session-less"
4. 编辑模型从"重新生成驱动"升级到"Cursor 风格 inline 编辑"
5. PPT 上下文从"用户选择路径"简化到"有就显示,没有跳过"
6. 字体处理从"程序计算"切换到"LLM 控字数 + 程序复核"
7. 安全模型从"沙箱执行"简化到"声明式 renderer + LLM inspector"

每一次收敛都让产品更克制、更诚实、更聚焦。
