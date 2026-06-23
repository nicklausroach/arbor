export interface GraphNode {
  id: string;
  dependsOn: string[];
}

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  d: string;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

const NW = 225;
const NH = 104;
const HG = 252;
const VG = 34;
const MID_Y = 248;

export function layoutGraph<T extends GraphNode>(tickets: T[]): Layout {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const calc = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // guard against cycles slipping through during edit
    const t = byId.get(id);
    let d = 0;
    for (const dep of t?.dependsOn ?? []) {
      if (byId.has(dep)) d = Math.max(d, calc(dep, new Set(seen).add(id)) + 1);
    }
    depth.set(id, d);
    return d;
  };
  for (const t of tickets) calc(t.id, new Set());

  const cols = new Map<number, T[]>();
  for (const t of tickets) {
    const c = depth.get(t.id) ?? 0;
    cols.set(c, [...(cols.get(c) ?? []), t]);
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of colKeys) {
    const arr = cols.get(c)!;
    const total = arr.length * NH + (arr.length - 1) * VG;
    let y = MID_Y - total / 2;
    for (const t of arr) {
      pos.set(t.id, { x: c * HG + 30, y });
      y += NH + VG;
    }
  }

  const nodes: LaidOutNode[] = tickets.map((t) => ({ id: t.id, ...pos.get(t.id)! }));
  const edges: LaidOutEdge[] = [];
  for (const t of tickets) {
    for (const dep of t.dependsOn) {
      const a = pos.get(dep);
      const b = pos.get(t.id);
      if (!a || !b) continue;
      const sx = a.x + NW;
      const sy = a.y + NH / 2;
      const tx = b.x;
      const ty = b.y + NH / 2;
      edges.push({ from: dep, to: t.id, d: `M${sx},${sy} C${sx + 64},${sy} ${tx - 64},${ty} ${tx},${ty}` });
    }
  }

  const maxCol = colKeys.length ? Math.max(...colKeys) : 0;
  return { nodes, edges, width: maxCol * HG + NW + 60, height: 510 };
}

export const NODE_WIDTH = NW;
export const NODE_HEIGHT = NH;
