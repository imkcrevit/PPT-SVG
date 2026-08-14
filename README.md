# PPT-SVG

PPT-SVG has two independent products backed by one source-grounded visual engine: **SVG** creates a single diagram with SVG/JSON/editable one-slide PPTX exports, while **PPT** creates a complete multi-slide presentation and reuses SVG for every diagram slide.

PPT-SVG包含两个独立产品：**SVG** 生成单张图并导出SVG、JSON或可编辑单页PPTX；**PPT** 生成整套多页演示文稿，并在所有图表页复用同一SVG引擎。两者都优先围绕用户上传资料、原文短引和原图展开。

## Demo

- SVG: `https://labs.graptolite.ai/svg/en`
- PPT: `https://labs.graptolite.ai/ppt/en`
- 中文SVG: `https://labs.graptolite.ai/svg/zh`
- 中文PPT: `https://labs.graptolite.ai/ppt/zh`

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/en/svg` or `http://localhost:3000/en/ppt`. Use `/zh/svg` and `/zh/ppt` for Chinese.

本地英文页面为 `http://localhost:3000/en/svg` 与 `http://localhost:3000/en/ppt`；中文页面使用 `/zh/svg` 与 `/zh/ppt`。

## Environment

```bash
PPT_SVG_LLM_API_KEY=local-only
PPT_SVG_LLM_MODEL=your-local-model
PPT_SVG_LLM_BASE_URL=http://127.0.0.1:11434/v1
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OPENROUTER_BASE_URL=
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=PPT-SVG
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_BASE_URL=
MONGODB_URI=
MONGODB_DB=ppt_svg
```

The private-first example targets a self-hosted OpenAI-compatible endpoint. Leave `OPENROUTER_*` and `OPENAI_*` unset when generation content must stay inside the private environment. Public model providers are opt-in: configuring their key, model, or base URL selects that provider.

`MONGODB_URI` is optional. When configured, conversations and hash-coded attachment paths are recorded in MongoDB.

## Installable SVG and PPT Skills

The repository includes Codex, Claude Code, and DeepSeek Harness plugins with two interoperable skills, plus compatible Hermes/OpenClaw installers. The web app and APIs remain the implementation source of truth.

### Codex

```bash
codex plugin marketplace add imkcrevit/PPT-SVG --ref main
codex plugin add ppt-svg@graptolite-labs
```

Invoke the installed skills as `$svg` and `$ppt`.

### Claude Code

```bash
claude plugin marketplace add imkcrevit/PPT-SVG
claude plugin install ppt-svg@graptolite-labs
```

Invoke the installed skills as `/ppt-svg:svg` and `/ppt-svg:ppt`. The Claude Code plugin also registers the bundled diagram MCP server.

### DeepSeek Harness (DSH)

Install the public GitHub bundle into a DSH profile, then inspect the composed configuration:

```bash
dsh plugin --profile default add github:imkcrevit/PPT-SVG#path:/plugins/ppt-svg
dsh --profile default --dump-config
```

Use `./plugins/ppt-svg` instead when installing from a local checkout. The bundle registers native `svg` and `ppt` skills plus `mcp__ppt_svg__render_<type>_svg` tools. After `dsh-ppt-svg` is published to npm, the install source can be replaced with the package name. For public DSH discovery, add the `dsh-plugin` topic to the GitHub repository.

For Hermes/OpenClaw:

```bash
cd /dev/ppt-svg/PPT-SVG
bash scripts/install-agent-skill.sh hermes
bash scripts/install-agent-skill.sh openclaw
```

Every bundled client now defaults to the local service. No Graptolite public endpoint is contacted unless an operator explicitly overrides the service URL:

```bash
export PPT_SVG_BASE_URL=http://127.0.0.1:3000/ppt
node plugins/ppt-svg/skills/svg/scripts/generate-svg.mjs \
  --language zh \
  --skill freeform \
  --prompt "生成一页产品路线图，包含 Q1 调研、Q2 MVP、Q3 公测、Q4 商用" \
  --bundle /tmp/ppt-svg-export.zip
```

Use `plugins/ppt-svg/skills/ppt/scripts/generate-ppt.mjs` for a complete deck. See [`docs/agent-skill.md`](docs/agent-skill.md) for install and privacy notes.

This local client boundary keeps prompts and attachments off the public Graptolite service. The local PPT-SVG process may still send generation content to its configured LLM provider; use `PPT_SVG_LLM_*` with a self-hosted endpoint when the complete pipeline must remain private.

## Why SVG-Driven

PPT-SVG keeps SVG and figure JSON as the primary rendering path so diagrams can use flexible layout, labels, hierarchy, dashed states, editable colors, and browser-native preview behavior without being limited by a slide format first.

PPT-SVG以SVG和figure JSON作为主要渲染路径，是为了保留更高的版式自由度：图形可以包含灵活布局、标签、层级、虚线状态、可编辑颜色和浏览器原生预览能力，而不是先被PPT形状格式限制。

- SVG download serializes the current browser preview as a standalone vector file.
- PPTX download posts the current figure JSON to `/api/export/pptx` and converts it into editable PowerPoint shapes.
- The SVG-driven path is the high-freedom source of truth; PPTX export is the compatibility output for presentation workflows.

- SVG下载会把当前浏览器预览序列化为独立矢量文件。
- PPTX下载会把当前figure JSON提交到 `/api/export/pptx`，并转换为可编辑PowerPoint形状。
- SVG驱动路径负责高自由度表达；PPTX导出负责兼容演示文稿工作流。

## Recent Export And Layout Updates

- Downloaded SVG and PPTX files are named with the recorded session ID plus an increasing download index: `<sessionId>-1.svg`, `<sessionId>-2.pptx`. This avoids browser-added `(1)` suffixes and keeps exported files tied to the generation log.
- Gantt layout now preserves explicit schedule intent, supports baseline-style timelines when the user asks for a Gantt chart, prioritizes time labels over long task text, and omits text that cannot fit without overlap.
- SVG and PPTX exports use unified connector semantics for arrows and folded connector lines, so arrows stay attached to the connector instead of being assembled as separate line and arrow shapes.
- PPTX export keeps text vertically centered in normal nodes, preserves left-aligned swimlane labels, and applies PowerPoint font sizes consistently.
- Prompt constraints now emphasize preserving user intent, avoiding fabricated defaults, and asking for clarification when the target diagram or meaning is unclear.

- 下载SVG和PPTX时，文件名使用日志中记录的session ID加递增下载序号：`<sessionId>-1.svg`、`<sessionId>-2.pptx`，避免浏览器追加 `(1)` 后缀，并让导出文件可追溯到生成日志。
- 甘特图布局会保留用户明确的排期意图；当用户指定甘特图时支持baseline风格时间线；在空间不足时优先展示时间，长任务文字无法容纳时不强行显示。
- SVG和PPTX导出统一使用连接线语义，箭头和多段折线保持为一个连接关系，不再用独立线条和箭头符号拼装。
- PPTX导出会保持普通节点文字居中、泳道名称左对齐，并稳定应用PowerPoint字号。
- 提示词约束强调不丢失用户意图、不伪造默认信息；目标不清晰时应先向用户澄清。

## Two-page bilingual UI

The app is bilingual. Use the language switch in the header or visit the locale routes directly:

应用支持中英双语。可以使用顶部语言切换，也可以直接访问对应路由：

- English SVG: `https://labs.graptolite.ai/svg/en`
- English PPT: `https://labs.graptolite.ai/ppt/en`
- 中文SVG: `https://labs.graptolite.ai/svg/zh`
- 中文PPT: `https://labs.graptolite.ai/ppt/zh`
- Local / 本地: `http://localhost:3000/{en|zh}/{svg|ppt}`

Legacy `/ppt/{locale}/svg`, `/ppt/{locale}/ppt`, and `/ppt/lab` URLs redirect to the short public routes.

PPT includes seven built-in style categories: tech, corporate, academic, government, nature, creative, and minimal. An uploaded PPTX template overrides the built-in style.

The selected locale is sent to the generation API as `language`, and prompt skills are instructed to output the same language.

当前语言会作为 `language` 传入生成接口，内部prompt skill会按同一语言输出。

## Supported Diagram Types

Current internal skills live in [`src/lib/skills.ts`](src/lib/skills.ts) and load prompt files from [`prompt/skills`](prompt/skills).

当前内置分类定义在 [`src/lib/skills.ts`](src/lib/skills.ts)，对应提示词文件位于 [`prompt/skills`](prompt/skills)。

| Skill ID | English | 中文 | Good For / 适用场景 | Example Prompt / 示例prompt |
| --- | --- | --- | --- | --- |
| `freeform` | Other / AI choice | 其他 / AI自由发挥 | Let AI choose the best visual structure. / 由AI自动选择结构。 | 生成一页面向管理层的AI客服改造方案图，自动选择最适合的结构。 |
| `flow` | Flow | 流程图 | Process flows, handoffs, lifecycle steps. / 流程、交接、生命周期。 | 画一个五步走的产品上线流程：需求评审 -> 设计 -> 开发 -> 测试 -> 发布，横向排列。 |
| `matrix` | Matrix | 矩阵 | 2x2 analysis, segmentation, prioritization. / 四象限、分群、优先级。 | 生成产品功能优先级四象限矩阵，横轴用户价值，纵轴实施成本。 |
| `timeline` | Timeline | 时间线 | Roadmaps, release plans, milestones. / 路线图、发布计划、里程碑。 | 生成产品路线图：Q1调研，Q2 MVP，Q3公测，Q4商用，并标出关键里程碑。 |
| `pyramid` | Pyramid | 金字塔 | Layered hierarchy, maturity models. / 分层结构、成熟度模型。 | 生成AI能力成熟度金字塔：数据基础、工具自动化、智能协同、业务自治。 |
| `architecture` | Architecture | 架构图 | System layers, services, platform diagrams. / 系统分层、服务关系、平台图。 | 画一个系统架构：A系统包含子系统B和C，其中B调用外部D系统。 |
| `hierarchy` | Hierarchy | 组织/层级图 | Org charts and top-down trees. / 组织架构、自上而下树。 | 生成研发组织架构图：CTO下设平台、应用、数据团队，各团队列出职责。 |
| `cycle` | Cycle | 循环图 | Cyclical loops, PDCA, lifecycle. / 循环流程、PDCA、生命周期。 | 生成企业AI应用持续改进循环图：问题收集、数据准备、验证、上线、评估、复盘、迭代。 |
| `funnel` | Funnel | 漏斗图 | Conversion or stage funnels. / 转化漏斗、阶段漏斗。 | 生成SaaS试用转化漏斗：访客、注册、激活、试用、付费，并标注数量和转化率。 |
| `venn` | Venn | 韦恩图 | 2-3 overlapping sets. / 2到3个交叠集合。 | 生成三集合韦恩图，对比产品可行性、技术可行性、商业价值。 |
| `mindmap` | Mind map | 思维导图 | Central topic with branches. / 中心主题向外发散。 | 生成企业知识库建设方案思维导图，包含内容来源、权限治理、检索体验、AI问答。 |
| `fishbone` | Fishbone | 鱼骨图 | Cause-effect analysis. / 因果分析、石川图。 | 生成“移动端转化率下降”的鱼骨图，按流量、体验、支付、营销、技术、数据拆因。 |
| `gantt` | Gantt | 甘特图 | Schedule with task bars. / 项目排期、任务条。 | 生成AI报表平台上线甘特图，周期第1到第10周，体现并行任务和里程碑。 |
| `swimlane` | Swimlane | 泳道图 | Cross-functional process lanes. / 跨职能泳道流程。 | 生成跨部门退款处理泳道图，泳道为用户、客服、财务、系统，并体现异常分支。 |
| `scatter` | Scatter | 散点/定位图 | 2D positioning by score. / 按评分二维定位。 | 生成项目组合定位图，横轴实施难度，纵轴业务收益，并标注优先区。 |
| `kanban` | Kanban | 看板 | Work stages and cards. / 工作阶段与卡片。 | 生成研发看板：待办、进行中、评审、完成。 |
| `network` | Network | 网络图 | Connected entities and topology. / 实体关系与拓扑。 | 生成系统依赖网络图，只保留资料明确写出的连接。 |
| `radar` | Radar | 雷达图 | Multi-axis comparison with supplied values. / 多维指标对比。 | 根据资料里的五项评分生成雷达图。 |
| `heatmap` | Heatmap | 热力图 | Two-dimensional intensity tables. / 二维强度表。 | 根据资料中的风险等级生成热力图。 |
| `waterfall` | Waterfall | 瀑布图 | Additive changes from a supplied baseline. / 基线与增减变化。 | 根据资料中的预算增减项生成瀑布图。 |
| `pie` | Pie / Donut | 饼图 / 环形图 | Composition and percentage breakdowns. / 构成与占比。 | 根据资料中的直营50、合作伙伴30、线上20生成饼图。 |
| `bar` | Bar / Column | 柱状图 / 条形图 | Numeric category comparison. / 类别数值对比。 | 根据四个季度的明确收入数值生成柱状图。 |
| `line` | Line / Trend | 折线图 / 趋势图 | Ordered numeric change. / 有序数值趋势。 | 根据一月至六月的明确数值生成折线图。 |

## Test Case Evidence

The committed API result set in [`tests/api-results/mainstream-diagrams`](tests/api-results/mainstream-diagrams) contains SVG files, prompts, API requests, returned figure JSON, and rendered SVG strings. Its README includes a table where every SVG is paired with the prompt that generated it.

已提交的API结果集位于 [`tests/api-results/mainstream-diagrams`](tests/api-results/mainstream-diagrams)，包含SVG文件、prompt、API请求、返回的figure JSON和渲染后的SVG字符串。该目录README已把每个SVG与生成它的prompt配对成表格。

- Generated at: `2026-05-28T14:49:01Z`
- Endpoint: `http://127.0.0.1:3000/ppt/api/generate`
- Total: `8`
- Passed: `8`
- Failed: `0`

Additional deterministic layout coverage lives in:

更多确定性布局覆盖在以下文件中：

- [`tests/diagram-regression.md`](tests/diagram-regression.md): human-readable regression prompts and assertions.
- [`tests/__snapshots__`](tests/__snapshots__): checked-in SVG snapshots for flow and architecture regressions.
- [`tests/all-diagrams-test.ts`](tests/all-diagrams-test.ts): renders the dedicated layout types and checks that geometry stays finite and inside the `1280x720` canvas.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run test:snapshots
npm run test:layout
npm run test:theme
npm run test:ui-selection
npm run test:mcp-routing
npm run test:mcp
npm run test:dsh
```

## Current scope

- Internal diagram types: `freeform`, `flow`, `matrix`, `timeline`, `pyramid`, `architecture`, `hierarchy`, `cycle`, `funnel`, `venn`, `mindmap`, `fishbone`, `gantt`, `swimlane`, `scatter`, `kanban`, `network`, `radar`, `heatmap`, `waterfall`, `pie`, `bar`, and `line`.
- Prompt files live in `/prompt` and are loaded by the server.
- SVG exports the current visual as vector SVG, figure JSON, or editable one-slide PPTX.
- PPT exports a complete PPTX and supports uploaded documents, images, and PPTX templates.
- The installable `svg` and `ppt` skills live under `plugins/ppt-svg/skills`; the same directory ships Codex, Claude Code, and DSH manifests and registers one MCP tool per diagram type.

## Optional Reverse Proxy

The app keeps `NEXT_PUBLIC_BASE_PATH=/ppt` internally for API and static assets. Nginx exposes the user-facing pages at `https://labs.graptolite.ai/svg/{locale}` and `https://labs.graptolite.ai/ppt/{locale}`.

Example Nginx and systemd files live in `deploy/`. They are deployment examples, not required for local development or for running the project directly on `localhost:3000`.
