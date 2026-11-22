import { describe, expect, it } from 'vitest';
import { TileMapBuilder, parseTiledMap } from './TileMapBuilder';

function createSampleLShapedTmj() {
  // 4x3 L-shaped map: top-right 2x1 cells (col 2,3 row 0) are void (GID 0)
  const floorData = [
    1, 1, 0, 0,
    1, 1, 1, 1,
    1, 1, 1, 1,
  ];
  // Block tile (1, 1) via collision layer
  const collisionData = [
    0, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 0,
  ];

  return {
    width: 4,
    height: 3,
    tilewidth: 32,
    tileheight: 32,
    properties: [
      { name: 'wallNorth', type: 'float', value: 3.5 },
      { name: 'wallSouth', type: 'float', value: 0 },
      { name: 'wallEast', type: 'float', value: 3.5 },
      { name: 'wallWest', type: 'float', value: 3.5 },
    ],
    layers: [
      { name: 'floor', type: 'tilelayer', data: floorData },
      { name: 'collision', type: 'tilelayer', data: collisionData },
      {
        name: 'interior_walls',
        type: 'objectgroup',
        objects: [
          {
            id: 1,
            name: 'partition_a',
            x: 64, // col 2.0
            y: 32, // row 1.0
            width: 6, // ~0.1875 tiles thick
            height: 32, // 1.0 tile long
            properties: [{ name: 'height', type: 'float', value: 2.5 }],
          },
        ],
      },
      {
        name: 'objects',
        type: 'objectgroup',
        objects: [
          {
            id: 10,
            name: 'spawn_entry',
            type: 'spawn',
            x: 16,
            y: 48,
            properties: [{ name: 'facing', type: 'string', value: 'right' }],
          },
          {
            id: 11,
            name: 'exit_zone',
            type: 'trigger',
            x: 96,
            y: 64,
            width: 32,
            height: 32,
            properties: [
              { name: 'triggerMode', type: 'string', value: 'enter' },
              { name: 'targetEnv', type: 'string', value: 'hallway' },
              { name: 'targetSpawnId', type: 'string', value: 'from_room' },
              { name: 'oneShot', type: 'bool', value: true },
            ],
          },
          {
            id: 12,
            name: 'ada_patrol',
            type: 'patrol',
            x: 32,
            y: 64,
            polyline: [
              { x: 0, y: 0 },
              { x: 64, y: 0 },
            ],
          },
          {
            id: 13,
            name: 'ada',
            type: 'npc',
            x: 32,
            y: 64,
            properties: [
              { name: 'spriteId', type: 'string', value: 'ada' },
              { name: 'patrolPath', type: 'string', value: 'ada_patrol' },
              { name: 'patrolMode', type: 'string', value: 'pingpong' },
              { name: 'moveSpeed', type: 'float', value: 2.0 },
            ],
          },
        ],
      },
    ],
  };
}

describe('TileMapBuilder & parseTiledMap', () => {
  it('enforces engine maxDimension and maxTiles budgets', () => {
    const oversized = {
      width: 65,
      height: 10,
      layers: [{ name: 'floor', type: 'tilelayer', data: new Array(650).fill(1) }],
    };
    expect(() => parseTiledMap(oversized)).toThrow(/exceeds engine tile budget/);

    const tooManyTiles = {
      width: 50,
      height: 50,
      layers: [{ name: 'floor', type: 'tilelayer', data: new Array(2500).fill(1) }],
    };
    expect(() => parseTiledMap(tooManyTiles, { maxTiles: 1000 })).toThrow(
      /exceeds engine tile budget/,
    );
  });

  it('skips void GID=0 floor tiles in merged geometry and marks them blocked in NavGrid', () => {
    const parsed = parseTiledMap(createSampleLShapedTmj());
    const built = TileMapBuilder.build(parsed);

    // 10 non-empty floor tiles out of 12 total => 40 vertices, 60 indices
    const posAttr = built.floorMesh.geometry.getAttribute('position');
    const indexAttr = built.floorMesh.geometry.getIndex();
    expect(posAttr.count).toBe(10 * 4);
    expect(indexAttr?.count).toBe(10 * 6);

    // Void cells (2,0) & (3,0) + collision cell (1,1) are blocked; (0,0) is walkable
    expect(built.navGrid.isTileBlocked(2, 0)).toBe(true);
    expect(built.navGrid.isTileBlocked(3, 0)).toBe(true);
    expect(built.navGrid.isTileBlocked(1, 1)).toBe(true);
    expect(built.navGrid.isTileWalkable(0, 0)).toBe(true);
  });

  it('builds border walls (omitting height 0) and registers interior_walls as AABB colliders', () => {
    const parsed = parseTiledMap(createSampleLShapedTmj());
    const built = TileMapBuilder.build(parsed);

    // 3 border walls (north, east, west; south=0 omitted) + 1 interior wall = 4 wall meshes
    expect(built.wallGroup.children).toHaveLength(4);
    expect(built.navGrid.getStaticBoxes()).toHaveLength(1);
    expect(built.navGrid.isBlockedAt(2.09, 1.5, 0.25, { ignoreCircles: true })).toBe(true);
  });

  it('parses spawns, enter triggers, patrol polylines, and NPC definitions in world tile units', () => {
    const parsed = parseTiledMap(createSampleLShapedTmj());

    expect(parsed.spawns.spawn_entry).toEqual({
      id: 'spawn_entry',
      x: 0.5,
      z: 1.5,
      facing: 'right',
    });

    expect(parsed.triggers).toHaveLength(1);
    expect(parsed.triggers[0]).toMatchObject({
      id: 'exit_zone',
      triggerMode: 'enter',
      targetEnv: 'hallway',
      targetSpawnId: 'from_room',
      oneShot: true,
      bounds: { minX: 3, maxX: 4, minZ: 2, maxZ: 3 },
    });

    expect(parsed.patrolPaths.ada_patrol).toEqual([
      { x: 1, z: 2 },
      { x: 3, z: 2 },
    ]);

    expect(parsed.npcs).toHaveLength(1);
    expect(parsed.npcs[0]).toMatchObject({
      id: 'ada',
      patrolPath: 'ada_patrol',
      patrolMode: 'pingpong',
      moveSpeed: 2.0,
    });
  });
});
