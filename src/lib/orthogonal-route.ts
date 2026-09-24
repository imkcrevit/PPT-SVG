// Orthogonal edge routing shared by the semantic layouts: a cheap direct
// route first, then an A* search on the Hanan grid that detours around the
// obstacle boxes when the direct route would cut through a card.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Pt {
  x: number;
  y: number;
}

const DEFAULT_DETOUR_GAP = 22;

export function center(box: Box): Pt {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Does an axis-aligned segment cross a rect's strict interior?
function segHitsRectInterior(x1: number, y1: number, x2: number, y2: number, r: Box): boolean {
  const rx1 = r.x;
  const ry1 = r.y;
  const rx2 = r.x + r.width;
  const ry2 = r.y + r.height;
  if (Math.abs(y1 - y2) < 0.01) {
    if (y1 <= ry1 || y1 >= ry2) return false;
    return Math.min(x1, x2) < rx2 && Math.max(x1, x2) > rx1;
  }
  if (x1 <= rx1 || x1 >= rx2) return false;
  return Math.min(y1, y2) < ry2 && Math.max(y1, y2) > ry1;
}

export function pathHitsObstacle(points: Pt[], obstacles: Box[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    for (const o of obstacles) {
      if (segHitsRectInterior(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, o)) return true;
    }
  }
  return false;
}

function inflate(b: Box, m: number): Box {
  return { x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m };
}

// Anchor on the side of `box` facing `toward`.
function sideAnchor(box: Box, toward: Pt): Pt {
  const c = center(box);
  if (Math.abs(toward.x - c.x) >= Math.abs(toward.y - c.y)) {
    return { x: toward.x >= c.x ? box.x + box.width : box.x, y: c.y };
  }
  return { x: c.x, y: toward.y >= c.y ? box.y + box.height : box.y };
}

// Orthogonal A* on the Hanan grid (obstacle corners + anchors) that routes
// around node boxes with clearance. Used only when the simple route is blocked.
function routeAround(source: Box, target: Box, obstacles: Box[]): Pt[] | null {
  const CLEAR = 12;
  // source/target block the path (so it can't cut through them) but are not
  // inflated, so an anchor on their border stays valid.
  const blockers = [source, target, ...obstacles.map((o) => inflate(o, CLEAR))];
  const a = sideAnchor(source, center(target));
  const b = sideAnchor(target, center(source));

  const uniq = (vals: number[]) => [...new Set(vals.map((v) => Math.round(v)))].sort((p, q) => p - q);
  const xs = uniq([a.x, b.x, ...blockers.flatMap((o) => [o.x, o.x + o.width])]);
  const ys = uniq([a.y, b.y, ...blockers.flatMap((o) => [o.y, o.y + o.height])]);
  const ix = new Map(xs.map((v, i) => [v, i]));
  const iy = new Map(ys.map((v, i) => [v, i]));
  const si = ix.get(Math.round(a.x));
  const sj = iy.get(Math.round(a.y));
  const gi = ix.get(Math.round(b.x));
  const gj = iy.get(Math.round(b.y));
  if (si === undefined || sj === undefined || gi === undefined || gj === undefined) return null;

  const clear = (x1: number, y1: number, x2: number, y2: number) => !blockers.some((o) => segHitsRectInterior(x1, y1, x2, y2, o));
  const key = (i: number, j: number) => i * ys.length + j;
  const start = key(si, sj);
  const goal = key(gi, gj);
  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const open: Array<{ n: number; f: number }> = [{ n: start, f: 0 }];
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[gi]) + Math.abs(ys[j] - ys[gj]);
  const TURN = 40;

  while (open.length) {
    open.sort((p, q) => p.f - q.f);
    const { n } = open.shift()!;
    if (n === goal) break;
    const i = Math.floor(n / ys.length);
    const j = n % ys.length;
    const prev = cameFrom.get(n);
    const pdir = prev === undefined ? -1 : Math.floor(prev / ys.length) === i ? 0 : 1; // 0=horiz,1=vert incoming
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      if (!clear(xs[i], ys[j], xs[ni], ys[nj])) continue;
      const dir = di !== 0 ? 0 : 1;
      const step = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (pdir !== -1 && pdir !== dir ? TURN : 0);
      const nk = key(ni, nj);
      const tentative = (gScore.get(n) ?? Infinity) + step;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, n);
        gScore.set(nk, tentative);
        open.push({ n: nk, f: tentative + h(ni, nj) });
      }
    }
  }
  if (!cameFrom.has(goal) && goal !== start) return null;

  const raw: Pt[] = [];
  let cur = goal;
  raw.push({ x: xs[Math.floor(cur / ys.length)], y: ys[cur % ys.length] });
  while (cur !== start) {
    const p = cameFrom.get(cur);
    if (p === undefined) return null;
    cur = p;
    raw.push({ x: xs[Math.floor(cur / ys.length)], y: ys[cur % ys.length] });
  }
  raw.reverse();
  // Drop collinear midpoints.
  const pts: Pt[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (k > 0 && k < raw.length - 1) {
      const a1 = raw[k - 1];
      const b1 = raw[k];
      const c1 = raw[k + 1];
      if ((a1.x === b1.x && b1.x === c1.x) || (a1.y === b1.y && b1.y === c1.y)) continue;
    }
    pts.push(raw[k]);
  }
  return pts.length >= 2 ? pts : null;
}

export function routeEdge(source: Box, target: Box, obstacles: Box[], detourGap = DEFAULT_DETOUR_GAP): Pt[] {
  const simple = simpleRoute(source, target, obstacles, detourGap);
  if (!pathHitsObstacle(simple, obstacles)) return simple;
  const around = routeAround(source, target, obstacles);
  return around && !pathHitsObstacle(around, obstacles) ? around : simple;
}

function simpleRoute(source: Box, target: Box, obstacles: Box[], detourGap: number): Pt[] {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const vertical = Math.abs(targetCenter.y - sourceCenter.y) > Math.abs(targetCenter.x - sourceCenter.x) + 1;

  if (vertical) {
    const down = targetCenter.y > sourceCenter.y;
    const sourceY = down ? source.y + source.height : source.y;
    const targetY = down ? target.y : target.y + target.height;
    const channelY = (sourceY + targetY) / 2;

    if (Math.abs(sourceCenter.x - targetCenter.x) < 2) {
      return [
        { x: sourceCenter.x, y: sourceY },
        { x: targetCenter.x, y: targetY }
      ];
    }

    return [
      { x: sourceCenter.x, y: sourceY },
      { x: sourceCenter.x, y: channelY },
      { x: targetCenter.x, y: channelY },
      { x: targetCenter.x, y: targetY }
    ];
  }

  const right = targetCenter.x > sourceCenter.x;
  const sourceX = right ? source.x + source.width : source.x;
  const targetX = right ? target.x : target.x + target.width;
  const corridor: Box = {
    x: Math.min(sourceX, targetX),
    y: Math.min(source.y, target.y),
    width: Math.abs(targetX - sourceX),
    height: Math.max(source.y + source.height, target.y + target.height) - Math.min(source.y, target.y)
  };
  const blocked = obstacles.some((obstacle) => intersects(corridor, obstacle));

  if (!blocked) {
    if (Math.abs(sourceCenter.y - targetCenter.y) < 2) {
      return [
        { x: sourceX, y: sourceCenter.y },
        { x: targetX, y: targetCenter.y }
      ];
    }

    const centerX = (sourceX + targetX) / 2;
    return [
      { x: sourceX, y: sourceCenter.y },
      { x: centerX, y: sourceCenter.y },
      { x: centerX, y: targetCenter.y },
      { x: targetX, y: targetCenter.y }
    ];
  }

  const laneY = Math.max(source.y + source.height, target.y + target.height) + detourGap;
  return [
    { x: sourceCenter.x, y: source.y + source.height },
    { x: sourceCenter.x, y: laneY },
    { x: targetCenter.x, y: laneY },
    { x: targetCenter.x, y: target.y + target.height }
  ];
}

// Pick a spot on the routed edge for its label plate that does not cover a
// card, a group title, a group border or another label. Longer segments and
// their midpoints are preferred; the plain midpoint is the last resort.
export function placeEdgeLabel(
  points: Pt[],
  plate: { width: number; height: number },
  blockers: Array<{ box: Box; container: boolean }>
): Pt {
  const segments = points
    .slice(0, -1)
    .map((a, index) => ({ a, b: points[index + 1], len: Math.abs(points[index + 1].x - a.x) + Math.abs(points[index + 1].y - a.y) }))
    .sort((p, q) => q.len - p.len);
  const fits = (c: Pt): boolean => {
    const box = { x: c.x - plate.width / 2 - 2, y: c.y - plate.height / 2 - 2, width: plate.width + 4, height: plate.height + 4 };
    return blockers.every(({ box: other, container }) => {
      if (!intersects(box, other)) return true;
      // A label fully inside a group body is fine; straddling its border is not.
      return container && box.x >= other.x && box.y >= other.y && box.x + box.width <= other.x + other.width && box.y + box.height <= other.y + other.height;
    });
  };
  for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    for (const { a, b } of segments) {
      const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (fits(c)) return c;
    }
  }
  // Nothing on the line is free: step outward beside the longest segment
  // (e.g. above two adjacent cards whose gap is narrower than the label).
  const { a, b } = segments[0];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const horizontal = Math.abs(b.y - a.y) < 1;
  for (let step = 1; step <= 8; step++) {
    const d = horizontal ? plate.height / 2 + 2 + (step - 1) * 8 : plate.width / 2 + 4 + (step - 1) * 8;
    for (const sign of [-1, 1]) {
      const c = horizontal ? { x: mid.x, y: mid.y + sign * d } : { x: mid.x + sign * d, y: mid.y };
      if (fits(c)) return c;
    }
  }
  return mid;
}
