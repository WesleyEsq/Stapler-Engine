import * as THREE from 'three';
import {
  DEFAULT_ENGINE_CONFIG,
  type Aabb2D,
  type EngineConfig,
  type FacingDirection,
  type LightConfig,
  type ParsedTiledMap,
  type PatrolMode,
  type TiledNpcDef,
  type TiledPropDef,
  type TiledSpawnDef,
  type TiledSpriteDef,
  type TiledTriggerDef,
  type TiledWallSegment,
  type TriggerMode,
  type Vec2,
  type WallConfig,
} from '../types/contracts';
import { NAV_BLOCKED, NavGrid } from '../navigation/NavGrid';

interface TiledPropertyRaw {
  name: string;
  type?: string;
  value: unknown;
}

interface TiledPointRaw {
  x: number;
  y: number;
}

interface TiledObjectRaw {
  id?: number;
  name?: string;
  type?: string;
  class?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  polyline?: TiledPointRaw[];
  polygon?: TiledPointRaw[];
  properties?: TiledPropertyRaw[];
}

interface TiledLayerRaw {
  name: string;
  type: 'tilelayer' | 'objectgroup' | 'imagelayer' | 'group' | string;
  data?: number[];
  objects?: TiledObjectRaw[];
  visible?: boolean;
}

interface TiledMapRaw {
  width: number;
  height: number;
  tilewidth?: number;
  tileheight?: number;
  layers?: TiledLayerRaw[];
  properties?: TiledPropertyRaw[];
}

export interface FloorTilesetAtlas {
  texture: THREE.Texture;
  columns: number;
  rows: number;
  firstGid?: number;
}

export interface TileMapBuildOptions {
  floorAtlas?: FloorTilesetAtlas;
  wallTexture?: THREE.Texture;
  /** Optional map of `textureId` -> `THREE.Texture` for interior/border walls. */
  wallTextures?: Record<string, THREE.Texture>;
}

export interface BuiltTileMap {
  parsed: ParsedTiledMap;
  group: THREE.Group;
  floorMesh: THREE.Mesh;
  wallGroup: THREE.Group;
  navGrid: NavGrid;
}

// Tiled encodes flip/rotation bits in the upper 3 bits of a 32-bit GID.
const TILED_GID_MASK = 0x1fffffff;

/**
 * Pure parser for Tiled `.tmj` JSON maps. Validates tile budgets, extracts void
 * floor tiles (`GID = 0`), collision layer, border & `interior_walls`, spawns,
 * triggers (`enter` | `interact`), NPCs, props, lights, and patrol polylines.
 */
export function parseTiledMap(
  rawInput: unknown,
  engineConfig?: Partial<EngineConfig>,
): ParsedTiledMap {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new Error('Invalid Tiled map: expected JSON object.');
  }

  const raw = rawInput as TiledMapRaw;
  const cfg: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...engineConfig };
  const width = Math.floor(raw.width);
  const height = Math.floor(raw.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid Tiled map dimensions: ${raw.width}x${raw.height}.`);
  }
  if (width > cfg.maxDimension || height > cfg.maxDimension || width * height > cfg.maxTiles) {
    throw new Error(
      `Tiled map ${width}x${height} exceeds engine tile budget (maxDimension=${cfg.maxDimension}, maxTiles=${cfg.maxTiles}).`,
    );
  }

  const tileWidth = raw.tilewidth && raw.tilewidth > 0 ? raw.tilewidth : 32;
  const tileHeight = raw.tileheight && raw.tileheight > 0 ? raw.tileheight : 32;
  const total = width * height;
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  const mapProps = propsToMap(raw.properties);

  const floorGids = new Uint32Array(total);
  const collisionFlags = new Uint8Array(total);

  const floorLayer = layers.find((l) => l.type === 'tilelayer' && l.name === 'floor');
  if (!floorLayer || !Array.isArray(floorLayer.data)) {
    throw new Error('Tiled map is missing required "floor" tile layer.');
  }
  if (floorLayer.data.length !== total) {
    throw new Error(
      `Tiled "floor" layer length (${floorLayer.data.length}) does not match map size ${width}x${height}.`,
    );
  }

  for (let i = 0; i < total; i += 1) {
    const rawGid = floorLayer.data[i] ?? 0;
    const gid = (rawGid & TILED_GID_MASK) >>> 0;
    floorGids[i] = gid;
    // Empty floor tiles (GID = 0) are void and automatically blocked in NavGrid.
    if (gid === 0) {
      collisionFlags[i] = NAV_BLOCKED;
    }
  }

  const collisionLayer = layers.find((l) => l.type === 'tilelayer' && l.name === 'collision');
  if (collisionLayer && Array.isArray(collisionLayer.data)) {
    for (let i = 0; i < Math.min(total, collisionLayer.data.length); i += 1) {
      if ((collisionLayer.data[i] ?? 0) !== 0) {
        collisionFlags[i] = NAV_BLOCKED;
      }
    }
  }

  const walls: WallConfig = {
    north: Math.max(0, asNumber(mapProps.wallNorth, 3.5)),
    south: Math.max(0, asNumber(mapProps.wallSouth, 0)),
    east: Math.max(0, asNumber(mapProps.wallEast, 3.5)),
    west: Math.max(0, asNumber(mapProps.wallWest, 3.5)),
  };

  // Parse optional `interior_walls` object layer
  const interiorWalls: TiledWallSegment[] = [];
  const interiorLayer = layers.find((l) => l.type === 'objectgroup' && l.name === 'interior_walls');
  if (interiorLayer && Array.isArray(interiorLayer.objects)) {
    for (let idx = 0; idx < interiorLayer.objects.length; idx += 1) {
      const obj = interiorLayer.objects[idx];
      if (!obj) continue;
      const props = propsToMap(obj.properties);
      const baseId = obj.name || `interior_wall_${obj.id ?? idx}`;
      const wallHeight = Math.max(0, asNumber(props.height, 3.0));
      if (wallHeight <= 0) continue;
      const textureId = asOptionalString(props.textureId);
      const doubleSided = asBoolean(props.doubleSided, true);
      const castShadow = asBoolean(props.castShadow, true);
      const blocksMovement = asBoolean(props.blocksMovement, true);
      const ox = (obj.x ?? 0) / tileWidth;
      const oz = (obj.y ?? 0) / tileHeight;

      if (Array.isArray(obj.polyline) && obj.polyline.length >= 2) {
        const thickness = Math.max(0.08, asNumber(props.thickness, 0.2));
        for (let p = 0; p < obj.polyline.length - 1; p += 1) {
          const a = obj.polyline[p];
          const b = obj.polyline[p + 1];
          if (!a || !b) continue;
          interiorWalls.push({
            id: `${baseId}_seg_${p}`,
            x1: ox + a.x / tileWidth,
            z1: oz + a.y / tileHeight,
            x2: ox + b.x / tileWidth,
            z2: oz + b.y / tileHeight,
            thickness,
            height: wallHeight,
            textureId,
            doubleSided,
            castShadow,
            blocksMovement,
          });
        }
      } else {
        const w = (obj.width ?? 0) / tileWidth;
        const h = (obj.height ?? 0) / tileHeight;
        if (w <= 0 && h <= 0) continue;
        // Represent rectangle as a centered segment along its longer axis
        if (w >= h) {
          interiorWalls.push({
            id: baseId,
            x1: ox,
            z1: oz + h * 0.5,
            x2: ox + w,
            z2: oz + h * 0.5,
            thickness: Math.max(0.08, h),
            height: wallHeight,
            textureId,
            doubleSided,
            castShadow,
            blocksMovement,
          });
        } else {
          interiorWalls.push({
            id: baseId,
            x1: ox + w * 0.5,
            z1: oz,
            x2: ox + w * 0.5,
            z2: oz + h,
            thickness: Math.max(0.08, w),
            height: wallHeight,
            textureId,
            doubleSided,
            castShadow,
            blocksMovement,
          });
        }
      }
    }
  }

  // Parse `objects` object layer
  const spawns: Record<string, TiledSpawnDef> = {};
  const triggers: TiledTriggerDef[] = [];
  const npcs: TiledNpcDef[] = [];
  const props: TiledPropDef[] = [];
  const sprites: TiledSpriteDef[] = [];
  const lights: LightConfig[] = [];
  const patrolPaths: Record<string, Vec2[]> = {};

  const objectsLayer = layers.find((l) => l.type === 'objectgroup' && l.name === 'objects');
  if (objectsLayer && Array.isArray(objectsLayer.objects)) {
    const rawObjects: TiledObjectRaw[] = objectsLayer.objects;
    for (let idx = 0; idx < rawObjects.length; idx += 1) {
      const obj = rawObjects[idx];
      if (!obj) continue;
      const objType = (obj.type || obj.class || '').toLowerCase();
      const objProps = propsToMap(obj.properties);
      const id = obj.name || `${objType || 'obj'}_${obj.id ?? idx}`;
      const ox = (obj.x ?? 0) / tileWidth;
      const oz = (obj.y ?? 0) / tileHeight;
      const ow = (obj.width ?? 0) / tileWidth;
      const oh = (obj.height ?? 0) / tileHeight;
      const centerX = ox + ow * 0.5;
      const centerZ = oz + oh * 0.5;

      switch (objType) {
        case 'spawn': {
          spawns[id] = {
            id,
            x: centerX,
            z: centerZ,
            facing: asFacing(objProps.facing, 'front'),
          };
          break;
        }
        case 'patrol': {
          const rawPoints = obj.polyline ?? obj.polygon;
          if (Array.isArray(rawPoints) && rawPoints.length >= 2) {
            patrolPaths[id] = rawPoints.map((pt) => ({
              x: ox + pt.x / tileWidth,
              z: oz + pt.y / tileHeight,
            }));
          }
          break;
        }
        case 'trigger': {
          const modeRaw = asOptionalString(objProps.triggerMode);
          const triggerMode: TriggerMode = modeRaw === 'enter' ? 'enter' : 'interact';
          const halfW = ow > 0 ? ow * 0.5 : 0.5;
          const halfH = oh > 0 ? oh * 0.5 : 0.5;
          triggers.push({
            id,
            name: obj.name || id,
            triggerMode,
            bounds: {
              id,
              minX: ow > 0 ? ox : ox - halfW,
              maxX: ow > 0 ? ox + ow : ox + halfW,
              minZ: oh > 0 ? oz : oz - halfH,
              maxZ: oh > 0 ? oz + oh : oz + halfH,
            },
            x: centerX,
            z: centerZ,
            interactionRadius: asNumber(objProps.interactionRadius, 1.25),
            targetEnv: asOptionalString(objProps.targetEnv),
            targetSpawnId: asOptionalString(objProps.targetSpawnId),
            facing: objProps.facing ? asFacing(objProps.facing, 'front') : undefined,
            scriptId: asOptionalString(objProps.scriptId),
            label: asOptionalString(objProps.label) ?? obj.name,
            oneShot: asBoolean(objProps.oneShot, false),
          });
          break;
        }
        case 'npc': {
          const modeRaw = asOptionalString(objProps.patrolMode);
          const patrolMode: PatrolMode =
            modeRaw === 'loop' || modeRaw === 'once' || modeRaw === 'pingpong'
              ? modeRaw
              : 'pingpong';
          npcs.push({
            id,
            name: obj.name || id,
            x: centerX,
            z: centerZ,
            spriteId: asOptionalString(objProps.spriteId) ?? id,
            scriptId: asOptionalString(objProps.scriptId),
            label: asOptionalString(objProps.label) ?? obj.name,
            interactionRadius: asNumber(objProps.interactionRadius, 1.35),
            solidRadius: Math.max(0, asNumber(objProps.solidRadius, 0.3)),
            patrolPath: asOptionalString(objProps.patrolPath),
            patrolMode,
            moveSpeed: asNumber(objProps.moveSpeed, 2.2),
            waitAtWaypointSec: Math.max(0, asNumber(objProps.waitAtWaypointSec, 0.8)),
          });
          break;
        }
        case 'prop_glb': {
          const modelUrl = asOptionalString(objProps.modelUrl);
          if (!modelUrl) break;
          const hasRectCollider = ow > 0 && oh > 0 && asOptionalString(objProps.collider) !== 'none';
          props.push({
            id,
            name: obj.name || id,
            x: centerX,
            z: centerZ,
            modelUrl,
            scale: asNumber(objProps.scale, 1),
            rotationY: asNumber(objProps.rotationY, 0),
            castShadow: asBoolean(objProps.castShadow, true),
            receiveShadow: asBoolean(objProps.receiveShadow, true),
            collider: hasRectCollider
              ? { id: `prop:${id}`, minX: ox, maxX: ox + ow, minZ: oz, maxZ: oz + oh }
              : undefined,
          });
          break;
        }
        case 'sprite_2d': {
          sprites.push({
            id,
            name: obj.name || id,
            x: centerX,
            z: centerZ,
            spriteId: asOptionalString(objProps.spriteId) ?? id,
            worldHeight:
              typeof objProps.worldHeight === 'number' ? objProps.worldHeight : undefined,
          });
          break;
        }
        case 'light': {
          const lType = asOptionalString(objProps.lightType);
          const type: LightConfig['type'] =
            lType === 'directional' || lType === 'spot' || lType === 'hemisphere' ? lType : 'point';
          lights.push({
            type,
            color: asOptionalString(objProps.color) ?? '#fff2df',
            groundColor: asOptionalString(objProps.groundColor),
            intensity: asNumber(objProps.intensity, 4),
            position: [centerX, asNumber(objProps.heightY, 3), centerZ],
            distance: typeof objProps.distance === 'number' ? objProps.distance : undefined,
            decay: typeof objProps.decay === 'number' ? objProps.decay : undefined,
            castShadow: asBoolean(objProps.castShadow, false),
          });
          break;
        }
        default:
          break;
      }
    }
  }

  return {
    width,
    height,
    tileWidth,
    tileHeight,
    floorGids,
    collisionFlags,
    walls,
    wallTextureId: asOptionalString(mapProps.wallTextureId),
    floorPrimaryColor: asOptionalString(mapProps.floorPrimaryColor),
    floorSecondaryColor: asOptionalString(mapProps.floorSecondaryColor),
    wallColor: asOptionalString(mapProps.wallColor),
    wallAccentColor: asOptionalString(mapProps.wallAccentColor),
    interiorWalls,
    spawns,
    triggers,
    npcs,
    props,
    sprites,
    lights,
    patrolPaths,
  };
}

/**
 * Builds Three.js merged floor geometry (omitting void `GID = 0` tiles),
 * border walls, extruded `interior_walls`, and a populated `NavGrid` from a
 * `ParsedTiledMap`.
 */
export class TileMapBuilder {
  static async loadAndBuild(
    mapUrl: string,
    options: TileMapBuildOptions & { engineConfig?: Partial<EngineConfig> } = {},
  ): Promise<BuiltTileMap> {
    const response = await fetch(mapUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Tiled map "${mapUrl}" (${response.status}).`);
    }
    const raw: unknown = await response.json();
    const parsed = parseTiledMap(raw, options.engineConfig);
    return TileMapBuilder.build(parsed, options);
  }

  static build(parsed: ParsedTiledMap, options: TileMapBuildOptions = {}): BuiltTileMap {
    const group = new THREE.Group();
    group.name = 'stapler_tilemap';

    // 1. Merged single-draw-call floor mesh skipping void GID = 0 tiles
    const floorGeometry = buildMergedFloorGeometry(parsed, options.floorAtlas);
    const floorTexture =
      options.floorAtlas?.texture ??
      createFallbackCheckerTexture(
        parsed.floorPrimaryColor ?? '#ebe3d3',
        parsed.floorSecondaryColor ?? '#e0d7c4',
        '#cbc1ad',
      );

    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.92,
      metalness: 0.0,
    });

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.receiveShadow = true;
    floorMesh.name = 'stapler_floor';
    group.add(floorMesh);

    // 2. NavGrid initialized from void floor + collision layer
    const navGrid = new NavGrid(parsed.width, parsed.height, parsed.collisionFlags);

    // Register prop footprint AABBs if defined in the map
    for (const prop of parsed.props) {
      if (prop.collider) {
        navGrid.addStaticBox(prop.collider);
      }
    }

    // 3. Outer border walls + extruded interior_walls
    const wallGroup = new THREE.Group();
    wallGroup.name = 'stapler_walls';

    const defaultWallTex =
      (parsed.wallTextureId && options.wallTextures?.[parsed.wallTextureId]) ||
      options.wallTexture ||
      createFallbackWallTexture(
        parsed.wallColor ?? '#d7e0e5',
        parsed.wallAccentColor ?? '#bac8d0',
      );

    const addBorderWall = (
      length: number,
      wallHeight: number,
      x: number,
      z: number,
      rotY: number,
    ): void => {
      if (wallHeight <= 0) return;
      const tex = defaultWallTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(length / 2, wallHeight / 2);

      const geo = new THREE.PlaneGeometry(length, wallHeight);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.9,
        metalness: 0.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, wallHeight * 0.5, z);
      mesh.rotation.y = rotY;
      mesh.receiveShadow = true;
      wallGroup.add(mesh);
    };

    addBorderWall(parsed.width, parsed.walls.north, parsed.width * 0.5, 0, 0);
    addBorderWall(parsed.width, parsed.walls.south, parsed.width * 0.5, parsed.height, Math.PI);
    addBorderWall(parsed.height, parsed.walls.west, 0, parsed.height * 0.5, Math.PI / 2);
    addBorderWall(parsed.height, parsed.walls.east, parsed.width, parsed.height * 0.5, -Math.PI / 2);

    for (const seg of parsed.interiorWalls) {
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const length = Math.hypot(dx, dz);
      if (length < 1e-4) continue;

      const baseTex = (seg.textureId && options.wallTextures?.[seg.textureId]) || defaultWallTex;
      const tex = baseTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, length / 2), Math.max(1, seg.height / 2));

      const geo = new THREE.BoxGeometry(length, seg.height, seg.thickness);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.88,
        metalness: 0.0,
        side: seg.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((seg.x1 + seg.x2) * 0.5, seg.height * 0.5, (seg.z1 + seg.z2) * 0.5);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.castShadow = seg.castShadow;
      mesh.receiveShadow = true;
      mesh.name = seg.id;
      wallGroup.add(mesh);

      if (seg.blocksMovement) {
        for (const box of wallSegmentToAabbs(seg)) {
          navGrid.addStaticBox(box);
        }
      }
    }

    group.add(wallGroup);

    return {
      parsed,
      group,
      floorMesh,
      wallGroup,
      navGrid,
    };
  }
}

/**
 * Converts a wall segment into one exact AABB (for axis-aligned walls) or a
 * tight chain of small AABBs (for angled polyline walls).
 */
export function wallSegmentToAabbs(seg: TiledWallSegment): Aabb2D[] {
  const halfT = seg.thickness * 0.5;
  const dx = seg.x2 - seg.x1;
  const dz = seg.z2 - seg.z1;

  // Axis-aligned horizontal or vertical wall => single exact AABB
  if (Math.abs(dz) < 1e-4) {
    return [
      {
        id: seg.id,
        minX: Math.min(seg.x1, seg.x2),
        maxX: Math.max(seg.x1, seg.x2),
        minZ: seg.z1 - halfT,
        maxZ: seg.z1 + halfT,
      },
    ];
  }
  if (Math.abs(dx) < 1e-4) {
    return [
      {
        id: seg.id,
        minX: seg.x1 - halfT,
        maxX: seg.x1 + halfT,
        minZ: Math.min(seg.z1, seg.z2),
        maxZ: Math.max(seg.z1, seg.z2),
      },
    ];
  }

  // Diagonal wall => chain of tight overlapping square AABBs along the segment
  const len = Math.hypot(dx, dz);
  const count = Math.max(2, Math.ceil(len / Math.max(0.2, seg.thickness)));
  const boxes: Aabb2D[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const px = seg.x1 + dx * t;
    const pz = seg.z1 + dz * t;
    boxes.push({
      id: `${seg.id}_c${i}`,
      minX: px - halfT,
      maxX: px + halfT,
      minZ: pz - halfT,
      maxZ: pz + halfT,
    });
  }
  return boxes;
}

function buildMergedFloorGeometry(
  parsed: ParsedTiledMap,
  atlas?: FloorTilesetAtlas,
): THREE.BufferGeometry {
  let tileCount = 0;
  for (let i = 0; i < parsed.floorGids.length; i += 1) {
    if ((parsed.floorGids[i] ?? 0) > 0) tileCount += 1;
  }

  const positions = new Float32Array(tileCount * 4 * 3);
  const normals = new Float32Array(tileCount * 4 * 3);
  const uvs = new Float32Array(tileCount * 4 * 2);
  const indices = new Uint32Array(tileCount * 6);

  const firstGid = atlas?.firstGid ?? 1;
  const cols = atlas ? Math.max(1, atlas.columns) : 1;
  const rows = atlas ? Math.max(1, atlas.rows) : 1;

  let vOffset = 0;
  let uvOffset = 0;
  let iOffset = 0;
  let vertBase = 0;

  for (let row = 0; row < parsed.height; row += 1) {
    for (let col = 0; col < parsed.width; col += 1) {
      const gid = parsed.floorGids[row * parsed.width + col] ?? 0;
      if (gid === 0) continue;

      const x0 = col;
      const x1 = col + 1;
      const z0 = row;
      const z1 = row + 1;

      // Four corners facing +Y (counter-clockwise when viewed from above)
      positions[vOffset++] = x0;
      positions[vOffset++] = 0;
      positions[vOffset++] = z0;

      positions[vOffset++] = x0;
      positions[vOffset++] = 0;
      positions[vOffset++] = z1;

      positions[vOffset++] = x1;
      positions[vOffset++] = 0;
      positions[vOffset++] = z1;

      positions[vOffset++] = x1;
      positions[vOffset++] = 0;
      positions[vOffset++] = z0;

      const nStart = vertBase * 3;
      for (let k = 0; k < 4; k += 1) {
        normals[nStart + k * 3] = 0;
        normals[nStart + k * 3 + 1] = 1;
        normals[nStart + k * 3 + 2] = 0;
      }

      if (atlas) {
        const localId = Math.max(0, gid - firstGid);
        const tileCol = localId % cols;
        const tileRow = Math.floor(localId / cols);
        const u0 = tileCol / cols;
        const u1 = (tileCol + 1) / cols;
        const v1 = 1 - tileRow / rows;
        const v0 = 1 - (tileRow + 1) / rows;

        uvs[uvOffset++] = u0;
        uvs[uvOffset++] = v1;
        uvs[uvOffset++] = u0;
        uvs[uvOffset++] = v0;
        uvs[uvOffset++] = u1;
        uvs[uvOffset++] = v0;
        uvs[uvOffset++] = u1;
        uvs[uvOffset++] = v1;
      } else {
        // World-space repeating UVs (2 tiles per checker period)
        const u0 = col * 0.5;
        const u1 = (col + 1) * 0.5;
        const v0 = row * 0.5;
        const v1 = (row + 1) * 0.5;

        uvs[uvOffset++] = u0;
        uvs[uvOffset++] = v0;
        uvs[uvOffset++] = u0;
        uvs[uvOffset++] = v1;
        uvs[uvOffset++] = u1;
        uvs[uvOffset++] = v1;
        uvs[uvOffset++] = u1;
        uvs[uvOffset++] = v0;
      }

      indices[iOffset++] = vertBase;
      indices[iOffset++] = vertBase + 1;
      indices[iOffset++] = vertBase + 2;
      indices[iOffset++] = vertBase;
      indices[iOffset++] = vertBase + 2;
      indices[iOffset++] = vertBase + 3;

      vertBase += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function createFallbackCheckerTexture(
  colorA: string,
  colorB: string,
  lineColor: string,
): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(new Uint8Array([235, 227, 211, 255]), 1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  const size = 256;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colorB;
  ctx.fillRect(half, 0, half, half);
  ctx.fillRect(0, half, half, half);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, half - 3, half - 3);
  ctx.strokeRect(half + 1.5, 1.5, half - 3, half - 3);
  ctx.strokeRect(1.5, half + 1.5, half - 3, half - 3);
  ctx.strokeRect(half + 1.5, half + 1.5, half - 3, half - 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function createFallbackWallTexture(baseColor: string, trimColor: string): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(new Uint8Array([215, 224, 229, 255]), 1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = trimColor;
  ctx.fillRect(0, size - 22, size, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(0, 0, 4, size);
  ctx.fillRect(size / 2, 0, 4, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function propsToMap(properties?: TiledPropertyRaw[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(properties)) return out;
  for (const prop of properties) {
    out[prop.name] = prop.value;
  }
  return out;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asFacing(value: unknown, fallback: FacingDirection): FacingDirection {
  if (value === 'front' || value === 'back' || value === 'left' || value === 'right') {
    return value;
  }
  return fallback;
}
