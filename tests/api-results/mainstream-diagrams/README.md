# Mainstream Diagram API Results

This folder is a committed evidence set for PPT-SVG diagram generation. Each SVG file below is paired with the prompt that generated it.

本目录是 PPT-SVG 图形生成能力的已提交证据集。下表中每个 SVG 都配有生成它的 prompt。

- Generated from local backend endpoint: `http://127.0.0.1:3000/ppt/api/generate`
- Generated at: `2026-05-28T14:49:01Z`
- Total: `8`
- Passed: `8`
- Failed: `0`

`results.json` contains each original input, API request, returned figure JSON, and rendered SVG string. Individual SVG previews and raw API responses are saved next to it.

`results.json` 包含每条原始输入、API 请求、返回的 figure JSON 和渲染后的 SVG 字符串。单独的 SVG 预览和原始 API 响应保存在同一目录。

## SVG Prompt Table / SVG 与 Prompt 对照表

| Type | SVG | Prompt |
| --- | --- | --- |
| Swimlane / 泳道图 | [01-swimlane-refund-process.svg](01-swimlane-refund-process.svg) | 生成一个跨部门退款处理泳道图。泳道按顺序为：用户、客服、财务、系统。流程包括：用户提交退款申请；系统校验订单状态；客服审核退款原因；如果资料缺失则客服要求用户补充；审核通过后财务复核金额；系统执行原路退款；用户收到到账通知。需要体现异常分支“订单已过退款期”直接结束。 |
| Gantt / 甘特图 | [02-gantt-ai-report-launch.svg](02-gantt-ai-report-launch.svg) | 生成一个 AI 报表平台上线甘特图，周期按第 1 到第 10 周。任务包括：需求梳理第1-2周，数据接入第2-5周，权限模型第3-6周，报表设计第4-7周，联调测试第7-9周，灰度上线第9-10周。请体现任务之间的并行关系和关键里程碑。 |
| Fishbone / 鱼骨图 | [03-fishbone-mobile-conversion-drop.svg](03-fishbone-mobile-conversion-drop.svg) | 生成一个“移动端转化率下降”的鱼骨图。结果是移动端转化率下降。原因大类包括：流量质量、页面体验、支付链路、营销策略、技术稳定性、数据统计。每个大类至少包含两个具体原因，例如加载慢、首屏信息不清、支付失败率升高、优惠规则复杂、埋点口径变化等。 |
| Mind map / 思维导图 | [04-mindmap-enterprise-knowledge-base.svg](04-mindmap-enterprise-knowledge-base.svg) | 生成一个“企业知识库建设方案”的思维导图。中心主题是企业知识库。一级分支包括：内容来源、权限治理、检索体验、AI 问答、运营机制、效果评估。每个一级分支下面给 2 到 3 个二级要点，内容要偏企业内部落地。 |
| Matrix / 矩阵 | [05-matrix-product-priority.svg](05-matrix-product-priority.svg) | 生成一个产品功能优先级四象限矩阵。横轴是用户价值从低到高，纵轴是实施成本从低到高。功能点包括：智能搜索、批量导入、权限模板、实时协作、自动摘要、数据看板、移动端适配、开放 API。请把每个功能放入合理象限，并给出简短理由。 |
| Scatter / 散点定位图 | [06-scatter-project-portfolio.svg](06-scatter-project-portfolio.svg) | 生成一个项目组合定位图。横轴是实施难度，纵轴是业务收益。项目包括：统一登录、客户画像、自动报价、预测补货、合同智能审阅、客服机器人、数据中台、移动审批。请根据常识给每个项目合理定位，并标注高收益低难度的优先区。 |
| Venn / 韦恩图 | [07-venn-innovation-fit.svg](07-venn-innovation-fit.svg) | 生成一个三集合韦恩图，对比“产品可行性、技术可行性、商业价值”。三个集合分别说明关注点，并在交集位置表达：可落地 MVP、技术领先但难变现、商业机会明确但实现风险高、最佳创新机会。 |
| Cycle / 循环图 | [08-cycle-ai-improvement-loop.svg](08-cycle-ai-improvement-loop.svg) | 生成一个企业 AI 应用持续改进循环图。步骤为：业务问题收集、数据准备、原型验证、上线试点、效果评估、风险复盘、策略迭代。每一步给一句简短说明，并形成闭环。 |

## Export Compatibility / 导出兼容性

The application supports both SVG and PPTX downloads. SVG is the high-freedom rendering source: it keeps the browser preview, vector output, layout details, and visual styling close to the generated figure JSON. PPTX export converts the same figure into editable PowerPoint shapes for slide workflows.

应用同时支持 SVG 和 PPTX 下载。SVG 是高自由度渲染源，负责保留浏览器预览、矢量输出、布局细节和视觉样式；PPTX 导出则把同一份 figure 转换为可编辑 PowerPoint 形状，用于演示文稿工作流。

## Bilingual Access / 中英切换

The app can be opened in either locale:

应用可以通过以下语言路由访问：

- Demo / 演示入口: `https://labs.graptolite.ai/ppt`
- English: `https://labs.graptolite.ai/ppt/en`
- 中文: `https://labs.graptolite.ai/ppt/zh`

The UI language switch changes the locale route, and the selected locale is sent to the generation API as the output language.

界面语言切换会切换对应 locale 路由，当前语言也会作为输出语言传给生成接口。
