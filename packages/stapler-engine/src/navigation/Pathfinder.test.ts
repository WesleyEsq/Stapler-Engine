import { describe, expect, it } from 'vitest';
import { NavGrid } from './NavGrid';
import { Pathfinder } from './Pathfinder';

describe('Pathfinder', () => {
  it('routes around an interior wall through a doorway and keeps every smoothed segment clear', () => {
    const grid = new NavGrid(8, 6);
    // Vertical interior partition at x = 4.0..4.2 from z = 0..4 (doorway open at z = 4..6)
    grid.addStaticBox({ id: 'partition', minX: 4.0, maxX: 4.2, minZ: 0, maxZ: 4 });

    const start = { x: 1.5, z: 1.5 };
    const goal = { x: 6.5, z: 1.5 };
    const path = Pathfinder.findPath(grid, start, goal, { agentRadius: 0.28, smooth: true });

    expect(path.length).toBeGreaterThanOrEqual(2);
    const end = path[path.length - 1]!;
    expect(end.x).toBeCloseTo(goal.x, 3);
    expect(end.z).toBeCloseTo(goal.z, 3);

    // Every smoothed segment must have valid radius-aware line of sight (no clipping wall)
    let prev = start;
    for (const wp of path) {
      expect(grid.hasLineOfSight(prev.x, prev.z, wp.x, wp.z, 0.28, { ignoreCircles: true })).toBe(
        true,
      );
      prev = wp;
    }

    // Must actually pass south of the wall (z > 4)
    expect(path.some((wp) => wp.z > 4.0)).toBe(true);
  });

  it('prevents diagonal corner-cutting between diagonally adjacent blocked tiles', () => {
    const grid = new NavGrid(4, 4);
    // Checkerboard barrier blocking diagonal squeeze between (1,1) and (2,2)
    grid.setTileBlocked(2, 1, true);
    grid.setTileBlocked(1, 2, true);
    grid.setTileBlocked(0, 2, true);
    grid.setTileBlocked(2, 0, true);
    grid.setTileBlocked(3, 1, true);
    grid.setTileBlocked(1, 3, true);

    // Region {(0,0),(1,0),(0,1),(1,1)} is diagonally touching {(2,2),(3,2),(2,3),(3,3)}
    // With corner-cutting disallowed, there must be NO path across the diagonal pinch.
    const path = Pathfinder.findPath(grid, { x: 1.5, z: 1.5 }, { x: 2.5, z: 2.5 });
    expect(path).toEqual([]);
  });

  it('returns an empty path when the goal is completely enclosed', () => {
    const grid = new NavGrid(5, 5);
    // Wall off column 2 completely from top to bottom
    for (let row = 0; row < 5; row += 1) {
      grid.setTileBlocked(2, row, true);
    }

    const path = Pathfinder.findPath(grid, { x: 0.5, z: 2.5 }, { x: 4.5, z: 2.5 });
    expect(path).toEqual([]);
  });

  it('collapses open-floor movement into a single direct waypoint via string-pulling', () => {
    const grid = new NavGrid(10, 10);
    const path = Pathfinder.findPath(grid, { x: 1.2, z: 1.4 }, { x: 8.7, z: 7.3 });
    expect(path).toEqual([{ x: 8.7, z: 7.3 }]);
  });
});
