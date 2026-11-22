import * as THREE from 'three';

export interface PaperSpriteOptions {
  texture: THREE.Texture;
  worldHeight: number;
  aspectRatio?: number;
  alphaTest?: number;
  /** Offset in world units to seat feet flush on y = 0 (positive lowers sprite). */
  groundOffset?: number;
  /** Duration in seconds for the horizontal Paper-Mario-style card flip. */
  flipDuration?: number;
}

/**
 * 2D paper-cutout sprite standing vertically on the 3D plane.
 * Uses `alphaTest` cutout transparency + `customDepthMaterial` so sprites
 * receive scene lighting, avoid Z-sorting glitches, and cast crisp silhouette shadows.
 */
export class PaperSprite {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;

  private readonly flipDuration: number;
  private facingRight = true;
  private flipProgress = 0; // 0 = facing right (rotY=0), 1 = facing left (rotY=PI)
  private walkTime = 0;
  private isMoving = false;
  private readonly baseMeshY: number;

  constructor(options: PaperSpriteOptions) {
    const aspect = options.aspectRatio ?? 1.0;
    const width = options.worldHeight * aspect;
    const height = options.worldHeight;
    const alphaTest = options.alphaTest ?? 0.5;
    this.flipDuration = options.flipDuration ?? 0.14;

    const geometry = new THREE.PlaneGeometry(width, height);
    this.baseMeshY = height * 0.5 - (options.groundOffset ?? 0);

    this.material = new THREE.MeshStandardMaterial({
      map: options.texture,
      alphaTest,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
    });

    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: options.texture,
      alphaTest,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = this.baseMeshY;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;

    this.root.add(this.mesh);
  }

  setPosition(x: number, z: number): void {
    this.root.position.set(x, 0, z);
  }

  getPosition(): { x: number; z: number } {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  setFacingRight(right: boolean): void {
    this.facingRight = right;
  }

  setMoving(moving: boolean): void {
    this.isMoving = moving;
  }

  /** Switches between dynamic PBR lighting and uniform unlit flat rendering. */
  setFlatLighting(flat: boolean): void {
    if (flat) {
      this.material.emissive.setHex(0xffffff);
      this.material.emissiveMap = this.material.map;
      this.material.emissiveIntensity = 0.85;
    } else {
      this.material.emissive.setHex(0x000000);
      this.material.emissiveMap = null;
      this.material.emissiveIntensity = 0;
    }
    this.material.needsUpdate = true;
  }

  update(dt: number): void {
    // Smooth horizontal paper-flip tween
    const target = this.facingRight ? 0 : 1;
    if (this.flipProgress !== target) {
      const step = this.flipDuration > 0 ? dt / this.flipDuration : 1;
      if (this.flipProgress < target) {
        this.flipProgress = Math.min(target, this.flipProgress + step);
      } else {
        this.flipProgress = Math.max(target, this.flipProgress - step);
      }
      // Smoothstep easing for crisp tactile card turn
      const t = this.flipProgress * this.flipProgress * (3 - 2 * this.flipProgress);
      this.mesh.rotation.y = t * Math.PI;
    }

    // Subtle procedural walk bob + slight paper tilt while moving
    if (this.isMoving) {
      this.walkTime += dt * 11.5;
      const bob = Math.abs(Math.sin(this.walkTime)) * 0.08;
      const tilt = Math.sin(this.walkTime) * 0.04;
      this.mesh.position.y = this.baseMeshY + bob;
      this.mesh.rotation.z = tilt;
    } else {
      this.walkTime = 0;
      this.mesh.position.y += (this.baseMeshY - this.mesh.position.y) * Math.min(1, dt * 16);
      this.mesh.rotation.z += (0 - this.mesh.rotation.z) * Math.min(1, dt * 16);
    }
  }
}
