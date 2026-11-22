import type { Aabb2D, CircleCollider2D, Vec2 } from '../types/contracts';

export const NAV_WALKABLE = 0;
export const NAV_BLOCKED = 1;

/**
 * Compact walkability grid (`Uint8Array`) supplemented by lightweight 2D AABB
 * obstacles (thin interior walls & props) and dynamic circular blockers (NPCs).
 * Provides pure, deterministic collision resolution and radius-aware line-of-sight tests.
 */
export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;

  private readonly staticBoxes: Aabb2D[] = [];
  private readonly circleBlockers = new Map<string, CircleCollider2D>();

  constructor(width: number, height: number, initialCells?: Uint8Array) {
    if (width <= 0 || height <= 0) {
      throw new Error(`NavGrid dimensions must be positive (got ${width}x${height}).`);
    }
    this.width = width;
    this.height = height;
    if (initialCells) {
      if (initialCells.length !== width * height) {
        throw new Error(
          `NavGrid initialCells length (${initialCells.length}) does not match ${width}x${height}.`,
        );
      }
      this.cells = new Uint8Array(initialCells);
    } else {
      this.cells = new Uint8Array(width * height);
    }
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  setTileBlocked(col: number, row: number, blocked: boolean): void {
    if (!this.inBounds(col, row)) return;
    this.cells[row * this.width + col] = blocked ? NAV_BLOCKED : NAV_WALKABLE;
  }

  isTileBlocked(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return true;
    return this.cells[row * this.width + col] === NAV_BLOCKED;
  }

  isTileWalkable(col: number, row: number): boolean {
    return !this.isTileBlocked(col, row);
  }

  addStaticBox(box: Aabb2D): void {
    this.staticBoxes.push({ ...box });
  }

  getStaticBoxes(): readonly Aabb2D[] {
    return this.staticBoxes;
  }

  setCircleBlocker(blocker: CircleCollider2D): void {
    this.circleBlockers.set(blocker.id, { ...blocker });
  }

  removeCircleBlocker(id: string): void {
    this.circleBlockers.delete(id);
  }

  getCircleBlockers(): CircleCollider2D[] {
    return Array.from(this.circleBlockers.values());
  }

  /**
   * Returns true if a circular agent at `(x, z)` with `radius` overlaps
   * map borders, any blocked `NavGrid` cell, any static 2D AABB obstacle,
   * or (optionally) any circular NPC blocker.
   */
  isBlockedAt(
    x: number,
    z: number,
    radius = 0.28,
    options: { ignoreCircleId?: string; ignoreCircles?: boolean } = {},
  ): boolean {
    // 1. Map outer boundaries
    if (x - radius < 0 || x + radius > this.width || z - radius < 0 || z + radius > this.height) {
      return true;
    }

    // 2. Overlapped tile cells in NavGrid (exact circle-vs-tile-AABB check)
    const minCol = Math.floor(x - radius);
    const maxCol = Math.floor(x + radius);
    const minRow = Math.floor(z - radius);
    const maxRow = Math.floor(z + radius);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (!this.isTileBlocked(col, row)) continue;
        if (circleIntersectsAabb(x, z, radius, col, col + 1, row, row + 1)) {
          return true;
        }
      }
    }

    // 3. Static sub-tile 2D AABB obstacles (interior walls & prop footprints)
    for (const box of this.staticBoxes) {
      if (circleIntersectsAabb(x, z, radius, box.minX, box.maxX, box.minZ, box.maxZ)) {
        return true;
      }
    }

    // 4. Dynamic circular blockers (NPCs)
    if (!options.ignoreCircles) {
      for (const circle of this.circleBlockers.values()) {
        if (options.ignoreCircleId && circle.id === options.ignoreCircleId) continue;
        const dx = x - circle.x;
        const dz = z - circle.z;
        const minDist = radius + circle.radius;
        if (dx * dx + dz * dz < minDist * minDist) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Resolves movement `(dx, dz)` with separate X and Z axis sliding and
   * sub-stepping so agents slide smoothly along walls/props without tunneling.
   */
  moveWithSlide(
    x: number,
    z: number,
    dx: number,
    dz: number,
    radius = 0.28,
    options: { ignoreCircleId?: string; ignoreCircles?: boolean } = {},
  ): Vec2 {
    const dist = Math.hypot(dx, dz);
    if (dist === 0) return { x, z };

    const maxStep = Math.max(0.05, radius * 0.45);
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const stepX = dx / steps;
    const stepZ = dz / steps;

    let curX = x;
    let curZ = z;

    for (let i = 0; i < steps; i += 1) {
      if (stepX !== 0) {
        const nextX = curX + stepX;
        if (!this.isBlockedAt(nextX, curZ, radius, options)) {
          curX = nextX;
        }
      }
      if (stepZ !== 0) {
        const nextZ = curZ + stepZ;
        if (!this.isBlockedAt(curX, nextZ, radius, options)) {
          curZ = nextZ;
        }
      }
    }

    return { x: curX, z: curZ };
  }

  /**
   * Radius-aware line-of-sight test between two world coordinates against
   * `NavGrid` tiles and static AABBs so path string-pulling never clips corners.
   */
  hasLineOfSight(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    radius = 0.28,
    options: { ignoreCircles?: boolean; ignoreCircleId?: string } = { ignoreCircles: true },
  ): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      return !this.isBlockedAt(x0, z0, radius, options);
    }

    const stepSize = Math.max(0.06, radius * 0.4);
    const steps = Math.max(1, Math.ceil(dist / stepSize));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      if (this.isBlockedAt(px, pz, radius, options)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Checks whether a tile center `(col + 0.5, row + 0.5)` is free for A* traversal
   * (walkable tile and not fully obstructed by static AABB obstacles).
   */
  isTileCenterClear(col: number, row: number, radius = 0.24): boolean {
    if (this.isTileBlocked(col, row)) return false;
    return !this.isBlockedAt(col + 0.5, row + 0.5, radius, { ignoreCircles: true });
  }

  /**
   * Finds the nearest unobstructed world position (checked on tile centers) to `(x, z)`.
   */
  findNearestWalkablePoint(x: number, z: number, radius = 0.28, maxTileRadius = 6): Vec2 | null {
    if (!this.isBlockedAt(x, z, radius, { ignoreCircles: true })) {
      return { x, z };
    }

    const startCol = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    const startRow = Math.max(0, Math.min(this.height - 1, Math.floor(z)));

    let best: Vec2 | null = null;
    let bestDistSq = Infinity;

    for (let r = 0; r <= maxTileRadius; r += 1) {
      for (let dr = -r; dr <= r; dr += 1) {
        for (let dc = -r; dc <= r; dc += 1) {
          if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue;
          const col = startCol + dc;
          const row = startRow + dr;
          if (!this.inBounds(col, row)) continue;
          const cx = col + 0.5;
          const cz = row + 0.5;
          if (this.isBlockedAt(cx, cz, radius, { ignoreCircles: true })) continue;
          const distSq = (cx - x) * (cx - x) + (cz - z) * (cz - z);
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = { x: cx, z: cz };
          }
        }
      }
      if (best) return best;
    }

    return null;
  }
}

export function circleIntersectsAabb(
  cx: number,
  cz: number,
  radius: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const closestX = Math.max(minX, Math.min(cx, maxX));
  const closestZ = Math.max(minZ, Math.min(cz, maxZ));
  const dx = cx - closestX;
  const dz = cz - closestZ;
  return dx * dx + dz * dz < radius * radius;
}
