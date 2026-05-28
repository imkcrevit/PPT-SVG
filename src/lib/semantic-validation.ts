import { isLocale } from "@/lib/i18n";
import { isSkillId } from "@/lib/skills";
import { sanitizeDisplayText } from "@/lib/text-layout";
import type { DiagramType, SemanticDiagram, SemanticEdge, SemanticLayer, SemanticNode } from "@/lib/semantic-types";
import type { Locale, SkillId } from "@/lib/types";

interface ValidationResult {
  ok: boolean;
  diagram?: SemanticDiagram;
  errors: string[];
}

type Path = Array<string | number>;

const MAX_NODES = 40;

export function validateAndNormalizeSemanticDiagram(
  value: unknown,
  expectedSkillId: SkillId,
  expectedLanguage: Locale
): ValidationResult {
  const errors: string[] = [];
  const root = readRecord(value, [], errors);

  if (!root) {
    return { ok: false, errors };
  }

  const diagramValue = "diagram" in root ? root.diagram : root;
  const diagramRecord = readRecord(diagramValue, ["diagram"], errors);

  if (!diagramRecord) {
    return { ok: false, errors };
  }

  const type = normalizeType(diagramRecord.type, expectedSkillId);
  const rawLanguage = readString(diagramRecord.language, ["diagram", "language"], errors, expectedLanguage);
  const language = isLocale(rawLanguage) ? rawLanguage : expectedLanguage;
  const nodesArray = readArray(diagramRecord.nodes, ["diagram", "nodes"], errors) ?? [];
  const { nodes, idMap } = normalizeNodes(nodesArray, errors);
  normalizeParents(nodes, idMap, errors);
  const edges = normalizeEdges(readArray(diagramRecord.edges, ["diagram", "edges"], errors) ?? [], idMap, errors);
  const layers = normalizeLayers(readArray(diagramRecord.layers, ["diagram", "layers"], []), idMap, nodes);
  const direction = diagramRecord.direction === "vertical" ? "vertical" : "horizontal";

  if (nodes.length === 0) {
    errors.push("diagram.nodes must contain at least one valid node.");
  }

  reportParentCycles(nodes, errors);

  const axesRec =
    diagramRecord.axes && typeof diagramRecord.axes === "object" && !Array.isArray(diagramRecord.axes)
      ? (diagramRecord.axes as Record<string, unknown>)
      : undefined;
  const axes = axesRec
    ? {
        xLabel: typeof axesRec.xLabel === "string" ? sanitizeDisplayText(axesRec.xLabel).slice(0, 40) : undefined,
        yLabel: typeof axesRec.yLabel === "string" ? sanitizeDisplayText(axesRec.yLabel).slice(0, 40) : undefined
      }
    : undefined;
  const lanesList = Array.isArray(diagramRecord.lanes)
    ? (diagramRecord.lanes as unknown[])
        .filter((lane): lane is string => typeof lane === "string")
        .map((lane) => sanitizeDisplayText(lane).slice(0, 40))
    : undefined;

  const diagram: SemanticDiagram = {
    type,
    title: readString(diagramRecord.title, ["diagram", "title"], errors, "Generated figure").slice(0, 80),
    description:
      typeof diagramRecord.description === "string" ? sanitizeDisplayText(diagramRecord.description).slice(0, 240) : undefined,
    language,
    direction,
    nodes,
    edges,
    layers: layers.length ? layers : undefined,
    axes,
    lanes: lanesList && lanesList.length ? lanesList : undefined
  };

  return {
    ok: errors.length === 0,
    diagram,
    errors
  };
}

function normalizeType(value: unknown, expectedSkillId: SkillId): DiagramType {
  const rawType = typeof value === "string" ? sanitizeDisplayText(value) : "";

  if (isSkillId(rawType)) {
    return rawType;
  }

  if (expectedSkillId === "flow" || expectedSkillId === "architecture") {
    return expectedSkillId;
  }

  return expectedSkillId === "freeform" ? "freeform" : expectedSkillId;
}

function normalizeNodes(
  values: unknown[],
  errors: string[]
): {
  nodes: SemanticNode[];
  idMap: Map<string, string>;
} {
  const idMap = new Map<string, string>();
  const seen = new Set<string>();
  const nodes: SemanticNode[] = [];
  const limitedValues = values.slice(0, MAX_NODES);

  if (values.length > MAX_NODES) {
    errors.push(`diagram.nodes has ${values.length} nodes; keep at most ${MAX_NODES}.`);
  }

  limitedValues.forEach((value, index) => {
    const path: Path = ["diagram", "nodes", index];
    const record = readRecord(value, path, errors);

    if (!record) {
      return;
    }

    const rawId = readString(record.id, [...path, "id"], errors, `node-${index + 1}`);
    const baseId = slugId(rawId || `node-${index + 1}`);
    const id = uniqueId(baseId, seen);

    if (id !== baseId) {
      errors.push(`${formatPath([...path, "id"])} is duplicated; generated "${id}".`);
    }

    if (!idMap.has(rawId)) {
      idMap.set(rawId, id);
    }
    idMap.set(id, id);

    const label = readString(record.label, [...path, "label"], errors, `Node ${index + 1}`).slice(0, 80);
    const detail = typeof record.detail === "string" ? sanitizeDisplayText(record.detail).slice(0, 420) : undefined;
    const emphasis = record.emphasis === "primary" || record.emphasis === "muted" || record.emphasis === "normal" ? record.emphasis : undefined;
    const lane = typeof record.lane === "string" ? sanitizeDisplayText(record.lane).slice(0, 40) || undefined : undefined;
    const start = typeof record.start === "number" || typeof record.start === "string" ? record.start : undefined;
    const end = typeof record.end === "number" || typeof record.end === "string" ? record.end : undefined;
    const scoreRec =
      record.score && typeof record.score === "object" && !Array.isArray(record.score)
        ? (record.score as Record<string, unknown>)
        : undefined;
    const toNum = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      return undefined;
    };
    const sx = scoreRec ? toNum(scoreRec.x) : undefined;
    const sy = scoreRec ? toNum(scoreRec.y) : undefined;
    const score = sx !== undefined && sy !== undefined ? { x: sx, y: sy } : undefined;

    nodes.push({
      id,
      label,
      detail: detail || undefined,
      parent: null,
      emphasis,
      dashed: record.dashed === true,
      lane,
      start,
      end,
      score
    });

    if (typeof record.parent === "string" && record.parent.trim()) {
      idMap.set(`${id}::__raw_parent`, sanitizeDisplayText(record.parent));
    } else if (record.parent !== null && record.parent !== undefined) {
      errors.push(`${formatPath([...path, "parent"])} must be null or an existing node id.`);
    }
  });

  return { nodes, idMap };
}

function normalizeParents(nodes: SemanticNode[], idMap: Map<string, string>, errors: string[]): void {
  const ids = new Set(nodes.map((node) => node.id));

  nodes.forEach((node, index) => {
    const rawParent = idMap.get(`${node.id}::__raw_parent`);

    if (!rawParent) {
      return;
    }

    const parentId = idMap.get(rawParent) ?? slugId(rawParent);
    if (parentId === node.id) {
      errors.push(`${formatPath(["diagram", "nodes", index, "parent"])} cannot point to itself.`);
      return;
    }

    if (!ids.has(parentId)) {
      errors.push(`${formatPath(["diagram", "nodes", index, "parent"])} references unknown node "${rawParent}".`);
      return;
    }

    node.parent = parentId;
  });
}

function normalizeEdges(values: unknown[], idMap: Map<string, string>, errors: string[]): SemanticEdge[] {
  const edges: SemanticEdge[] = [];

  values.forEach((value, index) => {
    const path: Path = ["diagram", "edges", index];
    const record = readRecord(value, path, errors);

    if (!record) {
      return;
    }

    const rawFrom = readString(record.from, [...path, "from"], errors, "");
    const rawTo = readString(record.to, [...path, "to"], errors, "");
    const from = idMap.get(rawFrom) ?? slugId(rawFrom);
    const to = idMap.get(rawTo) ?? slugId(rawTo);

    if (!idMap.has(rawFrom)) {
      errors.push(`${formatPath([...path, "from"])} references unknown node "${rawFrom}".`);
      return;
    }

    if (!idMap.has(rawTo)) {
      errors.push(`${formatPath([...path, "to"])} references unknown node "${rawTo}".`);
      return;
    }

    if (from === to) {
      errors.push(`${formatPath(path)} must not connect a node to itself.`);
      return;
    }

    edges.push({
      id: typeof record.id === "string" ? slugId(record.id) : undefined,
      from,
      to,
      label: typeof record.label === "string" ? sanitizeDisplayText(record.label).slice(0, 40) || undefined : undefined,
      dashed: record.dashed === true
    });
  });

  return edges;
}

function normalizeLayers(values: unknown[] | undefined, idMap: Map<string, string>, nodes: SemanticNode[]): SemanticLayer[] {
  if (!values) {
    return [];
  }

  const rootIds = new Set(nodes.filter((node) => node.parent === null).map((node) => node.id));
  const layers: SemanticLayer[] = [];

  values.forEach((value, index) => {
    const errors: string[] = [];
    const record = readRecord(value, ["diagram", "layers", index], errors);
    const rawNodeIds = readArray(record?.nodeIds, ["diagram", "layers", index, "nodeIds"], errors) ?? [];
    const nodeIds = rawNodeIds
      .map((item) => (typeof item === "string" ? idMap.get(sanitizeDisplayText(item)) ?? slugId(item) : ""))
      .filter((id) => rootIds.has(id));
    const name = typeof record?.name === "string" ? sanitizeDisplayText(record.name).slice(0, 40) : "";

    if (name && nodeIds.length) {
      layers.push({ name, nodeIds });
    }
  });

  return layers;
}

function reportParentCycles(nodes: SemanticNode[], errors: string[]): void {
  const parentById = new Map(nodes.map((node) => [node.id, node.parent]));

  for (const node of nodes) {
    const seen = new Set<string>();
    let current: string | null = node.parent;

    while (current) {
      if (seen.has(current)) {
        errors.push(`diagram.nodes has a parent cycle involving "${node.id}".`);
        break;
      }

      seen.add(current);
      current = parentById.get(current) ?? null;
    }
  }
}

function readRecord(value: unknown, path: Path, errors: string[]): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  errors.push(`${formatPath(path)} must be an object.`);
  return undefined;
}

function readArray(value: unknown, path: Path, errors: string[]): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  errors.push(`${formatPath(path)} must be an array.`);
  return undefined;
}

function readString(value: unknown, path: Path, errors: string[], fallback: string): string {
  const sanitized = typeof value === "string" ? sanitizeDisplayText(value) : "";

  if (sanitized) {
    return sanitized;
  }

  errors.push(`${formatPath(path)} must be a non-empty string.`);
  return fallback;
}

function uniqueId(baseId: string, seen: Set<string>): string {
  let candidate = baseId;
  let suffix = 2;

  while (seen.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  seen.add(candidate);
  return candidate;
}

function slugId(value: string): string {
  const slug = sanitizeDisplayText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "node";
}

function formatPath(path: Path): string {
  if (path.length === 0) {
    return "root";
  }

  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : part))
    .join(".")
    .replace(/\.\[/g, "[");
}
