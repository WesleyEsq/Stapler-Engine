import { describe, expect, it } from 'vitest';
import { NavGrid } from './NavGrid';

describe('NavGrid', () => {
  it('blocks outer boundaries, blocked tiles, static AABBs, and circular NPC blockers', () => {
    const grid = new NavGrid(6, 6);
    grid.setTileBlocked(2, 2, true);
    grid.addStaticBox({ id: 'desk', minX: 4.0, maxX: 5.2, minZ: 1.0, maxZ: 1.6 });
    grid.setCircleBlocker({ id: 'npc:ada', x: 1.5, z: 4.5, radius: 0.3 });

    // Outer border check
    expect(grid.isBlockedAt(0.1, 1.5, 0.28)).toBe(true);
    // Blocked tile check
    expect(grid.isBlockedAt(2.5, 2.5, 0.28)).toBe(true);
    // Sub-tile AABB desk check
    expect(grid.isBlockedAt(4.5, 1.3, 0.28)).toBe(true);
    expect(grid.isBlockedAt(4.5, 2.2, 0.28)).toBe(false);
    // Circular NPC blocker check
    expect(grid.isBlockedAt(1.8, 4.5, 0.28)).toBe(true);
    expect(grid.isBlockedAt(1.8, 4.5, 0.28, { ignoreCircleId: 'npc:ada' })).toBe(false);
  });

  it('slides cleanly along walls and interior partitions without tunneling', () => {
    const grid = new NavGrid(8, 8);
    // Thin vertical interior wall at x = 4.0..4.2 spanning z = 0..6
    grid.addStaticBox({ id: 'wall', minX: 4.0, maxX: 4.2, minZ: 0, maxZ: 6 });

    // Push diagonally into the wall from the left (3.6, 2.0) moving (+1.5, +1.0)
    const moved = grid.moveWithSlide(3.6, 2.0, 1.5, 1.0, 0.28);

    // Must NOT tunnel across x = 4.0, while sliding cleanly down along +Z
    expect(moved.x).toBeLessThanOrEqual(4.0 - 0.28 + 0.05);
    expect(moved.z).toBeCloseTo(3.0, 2);
  });

  it('enforces agent radius during line-of-sight checks near blocked corners', () => {
    const grid = new NavGrid(5, 5);
    grid.setTileBlocked(2, 2, true); // Occupies [2..3, 2..3]

    // Diagonal path from (1.9, 1.9) to (3.1, 3.1) passes right through blocked tile
    expect(grid.hasLineOfSight(1.9, 1.9, 3.1, 3.1, 0.28)).toBe(false);

    // Grazing path from (1.5, 2.5) to (2.5, 1.5) clips corner (2, 2) at distance ~0.0 (< 0.28)
    expect(grid.hasLineOfSight(1.5, 2.5, 2.5, 1.5, 0.28)).toBe(false);

    // Wide clear path well away from tile (2, 2) succeeds
    expect(grid.hasLineOfSight(0.5, 0.5, 4.5, 0.5, 0.28)).toBe(true);
  });
});
