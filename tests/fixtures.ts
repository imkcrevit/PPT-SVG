// Hand-calibrated "ideal answers" for the 8 regression prompts. These are the
// semantic graphs a correct model SHOULD produce. They are the input to the
// offline snapshot test, which compiles + renders them WITHOUT calling a model,
// so it isolates the compiler / renderer (layout-engine.ts, svg.ts).

import type { SemanticResponse } from "@/lib/semantic-types";

export interface Fixture {
  id: string;
  name: string;
  response: SemanticResponse;
}

const sub = (phase: string, items: string[]) =>
  items.map((label, i) => ({ id: `${phase}-${i}`, label, parent: phase }));

export const FIXTURES: Fixture[] = [
  {
    id: "T1-anchor",
    name: "Nesting + cross-boundary edge",
    response: {
      diagram: {
        type: "architecture",
        title: "A 系统集成示意",
        language: "zh",
        nodes: [
          { id: "a", label: "A 系统", parent: null },
          { id: "b", label: "子系统 B", parent: "a" },
          { id: "c", label: "子系统 C", parent: "a" },
          { id: "d", label: "D 系统", parent: null }
        ],
        edges: [{ from: "b", to: "d", label: "调用" }],
        layers: [
          { name: "内部域", nodeIds: ["a"] },
          { name: "外部系统", nodeIds: ["d"] }
        ]
      },
      fit: { score: 0.95, note: "" }
    }
  },
  {
    id: "T2-decompose",
    name: "Dense decomposition into nested nodes",
    response: {
      diagram: {
        type: "flow",
        title: "建筑项目从设计到交付全流程",
        language: "zh",
        direction: "horizontal",
        nodes: [
          { id: "start", label: "项目启动", parent: null, emphasis: "primary" },
          { id: "p1", label: "前期准备", parent: null },
          ...sub("p1", ["需求确认", "场地踏勘", "方案比选", "估算校核", "设计任务书"]),
          { id: "p2", label: "设计深化", parent: null },
          ...sub("p2", ["初步设计", "专业协调", "模型深化", "成本优化", "风险复核"]),
          { id: "p3", label: "报审采购", parent: null },
          ...sub("p3", ["报审材料", "审批沟通", "招采文件", "清单预算", "供应商确认"]),
          { id: "p4", label: "施工交付", parent: null },
          ...sub("p4", ["施工准备", "现场实施", "质量检查", "变更闭环", "竣工验收", "移交"]),
          { id: "end", label: "落地交付", parent: null, emphasis: "primary" }
        ],
        edges: [
          { from: "start", to: "p1" },
          { from: "p1", to: "p2" },
          { from: "p2", to: "p3" },
          { from: "p3", to: "p4" },
          { from: "p4", to: "end" }
        ]
      },
      fit: { score: 0.92, note: "" }
    }
  },
  {
    id: "T3-bands-dashed-detail",
    name: "Multi-band + dashed feedback + detail",
    response: {
      diagram: {
        type: "architecture",
        title: "RAG + 多 Agent 代码生成流水线",
        language: "zh",
        nodes: [
          { id: "collect", label: "数据采集", detail: "API.chm、SDK", parent: null },
          { id: "clean", label: "数据清洗", detail: "去噪、切片", parent: null },
          { id: "embed", label: "切分 + Embedding", detail: "text-embedding-3-large", parent: null },
          { id: "kb", label: "知识库", detail: "ChromaDB + SQLite：27,000+ 条目", parent: null },
          { id: "ask", label: "用户提问", parent: null, dashed: true },
          { id: "query", label: "Query Agent", detail: "改写模糊提问 / Gemini Flash", parent: null, emphasis: "primary" },
          { id: "retrieval", label: "Retrieval", detail: "向量 + 关键词", parent: null },
          { id: "rerank", label: "Rerank", detail: "Cohere v3.5", parent: null },
          { id: "score", label: "打分 Agent", detail: "评估检索质量，通过则进入下游", parent: null, emphasis: "primary" },
          { id: "code", label: "Code Agent", detail: "Claude：生成 C#", parent: null },
          { id: "halluc", label: "幻觉对抗 Agent", detail: "验证 API 真实存在；假 API 拒绝、重写", parent: null, emphasis: "primary" },
          { id: "param", label: "动态参数 Agent", detail: "查 Revit 现有模型，让用户选具体实例", parent: null, emphasis: "primary" },
          { id: "confirm", label: "用户确认", detail: "参数 + 代码", parent: null },
          { id: "revit", label: "Revit 执行", detail: "实际操作模型", parent: null },
          { id: "solid", label: "Tool 固化", detail: "多次成功后", parent: null },
          { id: "mcp", label: "MCP 工具库", detail: "自动扩展", parent: null }
        ],
        edges: [
          { from: "collect", to: "clean" },
          { from: "clean", to: "embed" },
          { from: "embed", to: "kb" },
          { from: "ask", to: "query" },
          { from: "query", to: "retrieval" },
          { from: "retrieval", to: "rerank" },
          { from: "rerank", to: "score" },
          { from: "score", to: "code" },
          { from: "code", to: "halluc" },
          { from: "halluc", to: "param" },
          { from: "param", to: "confirm" },
          { from: "halluc", to: "code", label: "假 API → 重写", dashed: true },
          { from: "confirm", to: "revit" },
          { from: "revit", to: "solid" },
          { from: "solid", to: "mcp" },
          { from: "mcp", to: "code", label: "下次同类直接调用", dashed: true }
        ],
        layers: [
          { name: "训练阶段：OFFLINE", nodeIds: ["collect", "clean", "embed", "kb"] },
          { name: "使用阶段 ①：RAG 检索", nodeIds: ["ask", "query", "retrieval", "rerank", "score"] },
          { name: "使用阶段 ②：代码生成 + 抗幻觉 + 用户确认", nodeIds: ["code", "halluc", "param", "confirm"] },
          { name: "使用阶段 ③：Revit 执行 + Tool 固化", nodeIds: ["revit", "solid", "mcp"] }
        ]
      },
      fit: { score: 0.9, note: "" }
    }
  },
  {
    id: "T4-flexible-detail",
    name: "Flexible detail (no forced two lines)",
    response: {
      diagram: {
        type: "flow",
        title: "三步流程",
        language: "zh",
        direction: "horizontal",
        nodes: [
          { id: "login", label: "登录", parent: null },
          { id: "process", label: "处理", detail: "调用支付网关、校验库存、写入订单，失败自动重试三次", parent: null },
          { id: "done", label: "完成", parent: null }
        ],
        edges: [
          { from: "login", to: "process" },
          { from: "process", to: "done" }
        ]
      },
      fit: { score: 0.95, note: "" }
    }
  },
  {
    id: "T5-deep-nesting",
    name: "Three-level nesting",
    response: {
      diagram: {
        type: "architecture",
        title: "电商平台系统架构",
        language: "zh",
        nodes: [
          { id: "platform", label: "电商平台", parent: null },
          { id: "order-center", label: "订单中心", parent: "platform" },
          { id: "oc-create", label: "下单服务", parent: "order-center" },
          { id: "oc-pay", label: "支付服务", parent: "order-center" },
          { id: "oc-refund", label: "退款服务", parent: "order-center" },
          { id: "user-center", label: "用户中心", parent: "platform" },
          { id: "uc-auth", label: "认证模块", parent: "user-center" },
          { id: "uc-member", label: "会员模块", parent: "user-center" }
        ],
        edges: [{ from: "order-center", to: "user-center", label: "查询用户" }]
      },
      fit: { score: 0.93, note: "" }
    }
  },
  {
    id: "T6-dashed-nodes",
    name: "Dashed external / tentative nodes",
    response: {
      diagram: {
        type: "flow",
        title: "数据处理流程",
        language: "zh",
        direction: "horizontal",
        nodes: [
          { id: "source", label: "外部数据源", detail: "外部不可控", parent: null, dashed: true },
          { id: "collect", label: "采集", parent: null },
          { id: "clean", label: "清洗", parent: null },
          { id: "store", label: "入库", parent: null },
          { id: "realtime", label: "实时同步", detail: "规划中", parent: null, dashed: true }
        ],
        edges: [
          { from: "source", to: "collect" },
          { from: "collect", to: "clean" },
          { from: "clean", to: "store" },
          { from: "store", to: "realtime", dashed: true }
        ]
      },
      fit: { score: 0.9, note: "" }
    }
  },
  {
    id: "T7-simple-flow",
    name: "Flat horizontal flow",
    response: {
      diagram: {
        type: "flow",
        title: "产品上线流程",
        language: "zh",
        direction: "horizontal",
        nodes: [
          { id: "review", label: "需求评审", parent: null },
          { id: "design", label: "设计", parent: null },
          { id: "dev", label: "开发", parent: null },
          { id: "test", label: "测试", parent: null },
          { id: "release", label: "发布", parent: null }
        ],
        edges: [
          { from: "review", to: "design" },
          { from: "design", to: "dev" },
          { from: "dev", to: "test" },
          { from: "test", to: "release" }
        ]
      },
      fit: { score: 0.96, note: "" }
    }
  },
  {
    id: "T8-scale",
    name: "Large graph scaling",
    response: {
      diagram: {
        type: "architecture",
        title: "企业中台架构",
        language: "zh",
        nodes: [
          { id: "d1", label: "用户中台", parent: null },
          ...sub("d1", ["账号服务", "权限服务", "组织服务", "标签服务", "画像服务"]),
          { id: "d2", label: "交易中台", parent: null },
          ...sub("d2", ["下单服务", "支付服务", "结算服务", "退款服务", "对账服务"]),
          { id: "d3", label: "商品中台", parent: null },
          ...sub("d3", ["商品服务", "类目服务", "库存服务", "价格服务"]),
          { id: "d4", label: "营销中台", parent: null },
          ...sub("d4", ["优惠券服务", "活动服务", "积分服务", "推荐服务"]),
          { id: "d5", label: "数据中台", parent: null },
          ...sub("d5", ["采集服务", "计算服务", "指标服务", "报表服务"]),
          { id: "d6", label: "技术中台", parent: null },
          ...sub("d6", ["网关服务", "配置中心", "消息服务", "任务调度"])
        ],
        edges: [
          { from: "d2", to: "d3", label: "扣减库存" },
          { from: "d2", to: "d4", label: "核销优惠" }
        ]
      },
      fit: { score: 0.85, note: "" }
    }
  }
];
