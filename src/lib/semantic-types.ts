// Semantic diagram layer.
//
// This is the LLM output space: no coordinates, sizes, colors, or absolute
// geometry. Containment lives in `parent`; connections live in `edges`.

export type DiagramType =
  | "freeform" | "flow" | "matrix" | "timeline" | "pyramid" | "architecture"
  | "hierarchy" | "cycle" | "funnel" | "venn" | "mindmap" | "fishbone"
  | "gantt" | "swimlane" | "scatter" | "kanban";

export type NodeEmphasis = "normal" | "primary" | "muted";

export interface SemanticNode {
  /** Unique stable id, referenced by parent / from / to. */
  id: string;
  /** The node's name/title. One label names one item. */
  label: string;
  /** Optional supporting text. The layout engine sizes the box to fit it. */
  detail?: string;
  /** Containment anchor. `null` = top-level; otherwise an existing node id. */
  parent: string | null;
  /** Optional visual weighting. */
  emphasis?: NodeEmphasis;
  /** Render this node with a dashed border. */
  dashed?: boolean;
  /** swimlane: lane name, must exist in SemanticDiagram.lanes. */
  lane?: string;
  /** gantt: start/end, numeric or numeric string such as week index. */
  start?: string | number;
  end?: string | number;
  /** scatter: semantic 2D position, x/y in 0..1. */
  score?: { x: number; y: number };
}

export interface SemanticEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  /** Render this connection as a dashed arrow. */
  dashed?: boolean;
}

/** Architecture: ordered horizontal bands of top-level nodes. */
export interface SemanticLayer {
  name: string;
  nodeIds: string[];
}

export interface SemanticDiagram {
  type: DiagramType;
  title: string;
  description?: string;
  language: "zh" | "en";
  direction?: "horizontal" | "vertical";
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  layers?: SemanticLayer[];
  /** matrix / scatter: axis labels. */
  axes?: { xLabel?: string; yLabel?: string };
  /** swimlane: lane order, top to bottom. */
  lanes?: string[];
}

export interface SemanticResponse {
  diagram: SemanticDiagram;
  fit: { score: number; note: string };
}
