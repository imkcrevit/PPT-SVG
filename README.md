# PPT-SVG

PPT-SVG generates single-slide presentation visuals from natural language. It asks an LLM for structured figure JSON, renders the result as SVG, and can export the same render as either SVG or PPTX.

PPT-SVG 用自然语言生成单页演示图形：模型输出结构化 figure JSON，前端渲染 SVG，并支持下载 SVG 或 PPTX。

## Demo

Demo: `https://labs.graptolite.ai/ppt`

演示地址：`https://labs.graptolite.ai/ppt`

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/en` or `http://localhost:3000/zh`.

打开 `http://localhost:3000/en` 或 `http://localhost:3000/zh`。

## Environment

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=PPT-SVG
PPT_SVG_LLM_API_KEY=
PPT_SVG_LLM_MODEL=
PPT_SVG_LLM_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_BASE_URL=https://api.openai.com/v1
MONGODB_URI=
MONGODB_DB=ppt_svg
```

`OPENROUTER_MODEL` controls the active model. Use any OpenRouter chat model, including Gemini, GPT, DeepSeek, and Claude model IDs.

For local Hermes/OpenClaw installs, users can bring their own OpenAI-compatible API by setting `PPT_SVG_LLM_API_KEY`, `PPT_SVG_LLM_MODEL`, and `PPT_SVG_LLM_BASE_URL`. If `OPENROUTER_*` is set, the existing OpenRouter path remains the default.

`MONGODB_URI` is optional. When configured, conversations and hash-coded attachment paths are recorded in MongoDB.

## Hermes / OpenClaw Agent Skill

PPT-SVG can also run as an installable Agent skill while keeping the current Web app form. The skill calls the same local or deployed service, so the UI, `/api/generate`, prompt files, SVG export, and PPTX export remain the source of truth.

```bash
cd /dev/ppt-svg/PPT-SVG
bash scripts/install-agent-skill.sh hermes
bash scripts/install-agent-skill.sh openclaw
```

Use a user-owned API key by running the local service with `OPENROUTER_*`, `PPT_SVG_LLM_*`, or `OPENAI_*` environment variables. The Agent side only needs the service URL:

```bash
export PPT_SVG_BASE_URL=http://127.0.0.1:3000/ppt
node scripts/ppt-svg-agent.mjs \
  --language zh \
  --skill freeform \
  --prompt "生成一页产品路线图，包含 Q1 调研、Q2 MVP、Q3 公测、Q4 商用" \
  --bundle /tmp/ppt-svg-export.zip
```

See [`docs/agent-skill.md`](docs/agent-skill.md) for the install notes.

## Why SVG-Driven

PPT-SVG keeps SVG and figure JSON as the primary rendering path so diagrams can use flexible layout, labels, hierarchy, dashed states, editable colors, and browser-native preview behavior without being limited by a slide format first.

PPT-SVG 以 SVG 和 figure JSON 作为主要渲染路径，是为了保留更高的版式自由度：图形可以包含灵活布局、标签、层级、虚线状态、可编辑颜色和浏览器原生预览能力，而不是先被 PPT 形状格式限制。

- SVG download serializes the current browser preview as a standalone vector file.
- PPTX download posts the current figure JSON to `/api/export/pptx` and converts it into editable PowerPoint shapes.
- The SVG-driven path is the high-freedom source of truth; PPTX export is the compatibility output for presentation workflows.

- SVG 下载会把当前浏览器预览序列化为独立矢量文件。
- PPTX 下载会把当前 figure JSON 提交到 `/api/export/pptx`，并转换为可编辑 PowerPoint 形状。
- SVG 驱动路径负责高自由度表达；PPTX 导出负责兼容演示文稿工作流。

## Recent Export And Layout Updates

- Downloaded SVG and PPTX files are named with the recorded session ID plus an increasing download index: `<sessionId>-1.svg`, `<sessionId>-2.pptx`. This avoids browser-added `(1)` suffixes and keeps exported files tied to the generation log.
- Gantt layout now preserves explicit schedule intent, supports baseline-style timelines when the user asks for a Gantt chart, prioritizes time labels over long task text, and omits text that cannot fit without overlap.
- SVG and PPTX exports use unified connector semantics for arrows and folded connector lines, so arrows stay attached to the connector instead of being assembled as separate line and arrow shapes.
- PPTX export keeps text vertically centered in normal nodes, preserves left-aligned swimlane labels, and applies PowerPoint font sizes consistently.
- Prompt constraints now emphasize preserving user intent, avoiding fabricated defaults, and asking for clarification when the target diagram or meaning is unclear.

- 下载 SVG 和 PPTX 时，文件名使用日志中记录的 session ID 加递增下载序号：`<sessionId>-1.svg`、`<sessionId>-2.pptx`，避免浏览器追加 `(1)` 后缀，并让导出文件可追溯到生成日志。
- 甘特图布局会保留用户明确的排期意图；当用户指定甘特图时支持 baseline 风格时间线；在空间不足时优先展示时间，长任务文字无法容纳时不强行显示。
- SVG 和 PPTX 导出统一使用连接线语义，箭头和多段折线保持为一个连接关系，不再用独立线条和箭头符号拼装。
- PPTX 导出会保持普通节点文字居中、泳道名称左对齐，并稳定应用 PowerPoint 字号。
- 提示词约束强调不丢失用户意图、不伪造默认信息；目标不清晰时应先向用户澄清。

## Bilingual UI

The app is bilingual. Use the language switch in the header or visit the locale routes directly:

应用支持中英双语。可以使用顶部语言切换，也可以直接访问对应路由：

- Demo / 演示入口: `https://labs.graptolite.ai/ppt`
- English: `https://labs.graptolite.ai/ppt/en`
- 中文: `https://labs.graptolite.ai/ppt/zh`
- Local English: `http://localhost:3000/en`
- 本地中文: `http://localhost:3000/zh`

The selected locale is sent to the generation API as `language`, and prompt skills are instructed to output the same language.

当前语言会作为 `language` 传入生成接口，内部 prompt skill 会按同一语言输出。

## Supported Diagram Types

Current internal skills live in [`src/lib/skills.ts`](src/lib/skills.ts) and load prompt files from [`prompt/skills`](prompt/skills).

当前内置分类定义在 [`src/lib/skills.ts`](src/lib/skills.ts)，对应提示词文件位于 [`prompt/skills`](prompt/skills)。

| Skill ID | English | 中文 | Good For / 适用场景 | Example Prompt / 示例 prompt |
| --- | --- | --- | --- | --- |
| `freeform` | Other / AI choice | 其他 / AI 自由发挥 | Let AI choose the best visual structure. / 由 AI 自动选择结构。 | 生成一页面向管理层的 AI 客服改造方案图，自动选择最适合的结构。 |
| `flow` | Flow | 流程图 | Process flows, handoffs, lifecycle steps. / 流程、交接、生命周期。 | 画一个五步走的产品上线流程：需求评审 -> 设计 -> 开发 -> 测试 -> 发布，横向排列。 |
| `matrix` | Matrix | 矩阵 | 2x2 analysis, segmentation, prioritization. / 四象限、分群、优先级。 | 生成产品功能优先级四象限矩阵，横轴用户价值，纵轴实施成本。 |
| `timeline` | Timeline | 时间线 | Roadmaps, release plans, milestones. / 路线图、发布计划、里程碑。 | 生成产品路线图：Q1 调研，Q2 MVP，Q3 公测，Q4 商用，并标出关键里程碑。 |
| `pyramid` | Pyramid | 金字塔 | Layered hierarchy, maturity models. / 分层结构、成熟度模型。 | 生成 AI 能力成熟度金字塔：数据基础、工具自动化、智能协同、业务自治。 |
| `architecture` | Architecture | 架构图 | System layers, services, platform diagrams. / 系统分层、服务关系、平台图。 | 画一个系统架构：A 系统包含子系统 B 和 C，其中 B 调用外部 D 系统。 |
| `hierarchy` | Hierarchy | 组织/层级图 | Org charts and top-down trees. / 组织架构、自上而下树。 | 生成研发组织架构图：CTO 下设平台、应用、数据团队，各团队列出职责。 |
| `cycle` | Cycle | 循环图 | Cyclical loops, PDCA, lifecycle. / 循环流程、PDCA、生命周期。 | 生成企业 AI 应用持续改进循环图：问题收集、数据准备、验证、上线、评估、复盘、迭代。 |
| `funnel` | Funnel | 漏斗图 | Conversion or stage funnels. / 转化漏斗、阶段漏斗。 | 生成 SaaS 试用转化漏斗：访客、注册、激活、试用、付费，并标注数量和转化率。 |
| `venn` | Venn | 韦恩图 | 2-3 overlapping sets. / 2 到 3 个交叠集合。 | 生成三集合韦恩图，对比产品可行性、技术可行性、商业价值。 |
| `mindmap` | Mind map | 思维导图 | Central topic with branches. / 中心主题向外发散。 | 生成企业知识库建设方案思维导图，包含内容来源、权限治理、检索体验、AI 问答。 |
| `fishbone` | Fishbone | 鱼骨图 | Cause-effect analysis. / 因果分析、石川图。 | 生成“移动端转化率下降”的鱼骨图，按流量、体验、支付、营销、技术、数据拆因。 |
| `gantt` | Gantt | 甘特图 | Schedule with task bars. / 项目排期、任务条。 | 生成 AI 报表平台上线甘特图，周期第 1 到第 10 周，体现并行任务和里程碑。 |
| `swimlane` | Swimlane | 泳道图 | Cross-functional process lanes. / 跨职能泳道流程。 | 生成跨部门退款处理泳道图，泳道为用户、客服、财务、系统，并体现异常分支。 |
| `scatter` | Scatter | 散点/定位图 | 2D positioning by score. / 按评分二维定位。 | 生成项目组合定位图，横轴实施难度，纵轴业务收益，并标注优先区。 |

## Test Case Evidence

The committed API result set in [`tests/api-results/mainstream-diagrams`](tests/api-results/mainstream-diagrams) contains SVG files, prompts, API requests, returned figure JSON, and rendered SVG strings. Its README includes a table where every SVG is paired with the prompt that generated it.

已提交的 API 结果集位于 [`tests/api-results/mainstream-diagrams`](tests/api-results/mainstream-diagrams)，包含 SVG 文件、prompt、API 请求、返回的 figure JSON 和渲染后的 SVG 字符串。该目录 README 已把每个 SVG 与生成它的 prompt 配对成表格。

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
```

## V1 Scope

- Internal skills: `freeform`, `flow`, `matrix`, `timeline`, `pyramid`, `architecture`, `hierarchy`, `cycle`, `funnel`, `venn`, `mindmap`, `fishbone`, `gantt`, `swimlane`, `scatter`.
- Prompt files live in `/prompt` and are loaded by the server.
- SVG export serializes the current browser preview as a standalone vector file.
- PPTX export writes the generated figure to the first slide as editable PowerPoint shapes.
- External skills, GitHub skill URLs, AI-created skills, and uploaded `SKILL.md` files are intentionally out of the first UI surface.

## Optional Reverse Proxy

The app can be served from a subpath such as `/ppt` by setting `NEXT_PUBLIC_BASE_PATH=/ppt` at build and runtime. The public demo is served at `https://labs.graptolite.ai/ppt`.

Example Nginx and systemd files live in `deploy/`. They are deployment examples, not required for local development or for running the project directly on `localhost:3000`.
