import type { Vec2 } from '../types/contracts';
import type { NavGrid } from './NavGrid';

export interface PathfinderOptions {
  /** Agent collision radius used for clearance and radius-aware string-pulling. */
  agentRadius?: number;
  /** Whether to run line-of-sight string-pulling on the A* path (default true). */
  smooth?: boolean;
}

const SQRT2 = Math.SQRT2;
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * 8-directional grid A* pathfinder with corner-cutting prevention and
 * radius-aware line-of-sight string-pulling for smooth float movement.
 */
export class Pathfinder {
  static findPath(
    grid: NavGrid,
    start: Vec2,
    goal: Vec2,
    options: PathfinderOptions = {},
  ): Vec2[] {
    const radius = options.agentRadius ?? 0.28;
    const smooth = options.smooth ?? true;

    // Fast path: direct radius-aware line of sight to an unobstructed goal
    if (
      smooth &&
      !grid.isBlockedAt(goal.x, goal.z, radius, { ignoreCircles: true }) &&
      grid.hasLineOfSight(start.x, start.z, goal.x, goal.z, radius, { ignoreCircles: true })
    ) {
      return [{ x: goal.x, z: goal.z }];
    }

    const startCol = clampInt(Math.floor(start.x), 0, grid.width - 1);
    const startRow = clampInt(Math.floor(start.z), 0, grid.height - 1);

    let resolvedGoal: Vec2 = goal;
    let goalCol = clampInt(Math.floor(goal.x), 0, grid.width - 1);
    let goalRow = clampInt(Math.floor(goal.z), 0, grid.height - 1);

    if (grid.isBlockedAt(resolvedGoal.x, resolvedGoal.z, radius, { ignoreCircles: true })) {
      const nearest = grid.findNearestWalkablePoint(goal.x, goal.z, radius, 4);
      if (!nearest) return [];
      resolvedGoal = nearest;
      goalCol = clampInt(Math.floor(nearest.x), 0, grid.width - 1);
      goalRow = clampInt(Math.floor(nearest.z), 0, grid.height - 1);
    }

    if (startCol === goalCol && startRow === goalRow) {
      return [{ x: resolvedGoal.x, z: resolvedGoal.z }];
    }

    const total = grid.width * grid.height;
    const startIdx = startRow * grid.width + startCol;
    const goalIdx = goalRow * grid.width + goalCol;

    const gScore = new Float32Array(total);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(total);
    cameFrom.fill(-1);
    const closed = new Uint8Array(total);

    const openHeap = new MinHeap();
    gScore[startIdx] = 0;
    openHeap.push(startIdx, octile(startCol, startRow, goalCol, goalRow));

    let found = false;
    while (openHeap.size > 0) {
      const current = openHeap.pop();
      if (current === goalIdx) {
        found = true;
        break;
      }
      if (closed[current]) continue;
      closed[current] = 1;

      const cx = current % grid.width;
      const cz = Math.floor(current / grid.width);
      const currentG = gScore[current] ?? Infinity;

      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!grid.inBounds(nx, nz)) continue;

        const nIdx = nz * grid.width + nx;
        if (closed[nIdx]) continue;

        // Check tile clearance (center clear against grid + static AABBs)
        if (nIdx !== goalIdx && !grid.isTileCenterClear(nx, nz, Math.min(radius, 0.24))) {
          continue;
        }

        // Prevent diagonal corner-cutting if either adjacent cardinal tile is blocked
        if (dx !== 0 && dz !== 0) {
          if (
            !grid.isTileCenterClear(cx + dx, cz, Math.min(radius, 0.24)) ||
            !grid.isTileCenterClear(cx, cz + dz, Math.min(radius, 0.24))
          ) {
            continue;
          }
        }

        // Verify actual segment between centers doesn't cross a thin interior wall AABB
        if (
          !grid.hasLineOfSight(
            cx + 0.5,
            cz + 0.5,
            nx + 0.5,
            nz + 0.5,
            Math.min(radius, 0.22),
            { ignoreCircles: true },
          )
        ) {
          continue;
        }

        const tentativeG = currentG + cost;
        if (tentativeG < (gScore[nIdx] ?? Infinity)) {
          cameFrom[nIdx] = current;
          gScore[nIdx] = tentativeG;
          const f = tentativeG + octile(nx, nz, goalCol, goalRow);
          openHeap.push(nIdx, f);
        }
      }
    }

    if (!found) {
      return [];
    }

    // Reconstruct raw tile-center path (excluding start tile, ending at resolvedGoal)
    const rawReversed: Vec2[] = [{ x: resolvedGoal.x, z: resolvedGoal.z }];
    let trace = cameFrom[goalIdx] ?? -1;
    while (trace !== -1 && trace !== startIdx) {
      const tx = trace % grid.width;
      const tz = Math.floor(trace / grid.width);
      rawReversed.push({ x: tx + 0.5, z: tz + 0.5 });
      trace = cameFrom[trace] ?? -1;
    }
    rawReversed.reverse();

    if (!smooth || rawReversed.length <= 1) {
      return rawReversed;
    }

    return Pathfinder.smoothPath(grid, start, rawReversed, radius);
  }

  /**
   * Greedy radius-aware line-of-sight string-pulling: collapses stair-step
   * waypoints into straight float segments without clipping blocked corners.
   */
  static smoothPath(grid: NavGrid, start: Vec2, waypoints: readonly Vec2[], radius: number): Vec2[] {
    if (waypoints.length <= 1) return [...waypoints];

    const smoothed: Vec2[] = [];
    let anchor: Vec2 = start;
    let index = 0;

    while (index < waypoints.length) {
      let furthest = index;
      for (let probe = waypoints.length - 1; probe > index; probe -= 1) {
        const candidate = waypoints[probe];
        if (!candidate) continue;
        if (grid.hasLineOfSight(anchor.x, anchor.z, candidate.x, candidate.z, radius, { ignoreCircles: true })) {
          furthest = probe;
          break;
        }
      }
      const next = waypoints[furthest];
      if (!next) break;
      smoothed.push({ x: next.x, z: next.z });
      anchor = next;
      index = furthest + 1;
    }

    return smoothed;
  }
}

function octile(x0: number, z0: number, x1: number, z1: number): number {
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

class MinHeap {
  private readonly ids: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, priority: number): void {
    this.ids.push(id);
    this.priorities.push(priority);
    this.bubbleUp(this.ids.length - 1);
  }

  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastP = this.priorities.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.priorities[0] = lastP;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    let idx = i;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if ((this.priorities[idx] ?? Infinity) >= (this.priorities[parent] ?? Infinity)) break;
      this.swap(idx, parent);
      idx = parent;
    }
  }

  private sinkDown(i: number): void {
    let idx = i;
    const len = this.ids.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < len && (this.priorities[left] ?? Infinity) < (this.priorities[smallest] ?? Infinity)) {
        smallest = left;
      }
      if (right < len && (this.priorities[right] ?? Infinity) < (this.priorities[smallest] ?? Infinity)) {
        smallest = right;
      }
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmpId = this.ids[a]!;
    const tmpP = this.priorities[a]!;
    this.ids[a] = this.ids[b]!;
    this.priorities[a] = this.priorities[b]!;
    this.ids[b] = tmpId;
    this.priorities[b] = tmpP;
  }
}
