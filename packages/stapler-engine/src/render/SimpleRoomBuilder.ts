import * as THREE from 'three';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type WallConfig } from '../types/contracts';

export interface SimpleRoomOptions {
  width: number;
  height: number;
  walls?: Partial<WallConfig>;
  floorPrimaryColor?: string;
  floorSecondaryColor?: string;
  wallColor?: string;
  wallAccentColor?: string;
  engineConfig?: Partial<EngineConfig>;
}

export interface BuiltRoom {
  group: THREE.Group;
  floorMesh: THREE.Mesh;
  width: number;
  height: number;
}

/**
 * Builds a single-draw-call floor plane and configurable border walls
 * (any height >= 0, with 0 omitting the wall for unobstructed camera views).
 */
export class SimpleRoomBuilder {
  static build(options: SimpleRoomOptions): BuiltRoom {
    const cfg: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...options.engineConfig };
    const { width, height } = options;

    if (width <= 0 || height <= 0) {
      throw new Error(`Room dimensions must be positive (got ${width}x${height}).`);
    }
    if (width > cfg.maxDimension || height > cfg.maxDimension || width * height > cfg.maxTiles) {
      throw new Error(
        `Room ${width}x${height} exceeds engine tile budget (maxDimension=${cfg.maxDimension}, maxTiles=${cfg.maxTiles}).`,
      );
    }

    const group = new THREE.Group();
    const walls: WallConfig = {
      north: options.walls?.north ?? 3.5,
      south: options.walls?.south ?? 0,
      east: options.walls?.east ?? 3.5,
      west: options.walls?.west ?? 3.5,
    };

    // Floor: 1 merged quad with tiled procedural paper-grid texture
    const floorTex = createTileTexture(
      options.floorPrimaryColor ?? '#e9e2d2',
      options.floorSecondaryColor ?? '#dfd6c3',
      '#cbc1ad',
    );
    floorTex.repeat.set(width / 2, height / 2);

    const floorGeo = new THREE.PlaneGeometry(width, height);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.92,
      metalness: 0.0,
    });

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(width * 0.5, 0, height * 0.5);
    floorMesh.receiveShadow = true;
    floorMesh.name = 'stapler_floor';
    group.add(floorMesh);

    const wallBase = options.wallColor ?? '#d4dde2';
    const wallAccent = options.wallAccentColor ?? '#bcc8cf';

    // Helper to build each border wall facing inward
    const addWall = (
      wallLength: number,
      wallHeight: number,
      x: number,
      z: number,
      rotY: number,
    ): void => {
      if (wallHeight <= 0) return;
      const wallTex = createWallTexture(wallBase, wallAccent);
      wallTex.repeat.set(wallLength / 2, wallHeight / 2);
      const geo = new THREE.PlaneGeometry(wallLength, wallHeight);
      const mat = new THREE.MeshStandardMaterial({
        map: wallTex,
        roughness: 0.9,
        metalness: 0.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, wallHeight * 0.5, z);
      mesh.rotation.y = rotY;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    addWall(width, walls.north, width * 0.5, 0, 0);
    addWall(width, walls.south, width * 0.5, height, Math.PI);
    addWall(height, walls.west, 0, height * 0.5, Math.PI / 2);
    addWall(height, walls.east, width, height * 0.5, -Math.PI / 2);

    return { group, floorMesh, width, height };
  }
}

function createTileTexture(colorA: string, colorB: string, lineColor: string): THREE.CanvasTexture {
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

  // Subtle paper tile seams
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

function createWallTexture(baseColor: string, trimColor: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // Subtle vertical paneling + wainscot trim
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
