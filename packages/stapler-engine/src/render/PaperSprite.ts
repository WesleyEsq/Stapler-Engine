import * as THREE from 'three';
import type { FacingDirection, SpriteAnimationClip } from '../types/contracts';

export interface PaperSpriteOptions {
  texture: THREE.Texture;
  worldHeight: number;
  aspectRatio?: number;
  alphaTest?: number;
  /** Offset in world units to seat feet flush on y = 0 (positive lowers sprite). */
  groundOffset?: number;
  /** Duration in seconds for the horizontal Paper-Mario-style card flip. */
  flipDuration?: number;
  /** Sprite-sheet grid columns (defaults to 1 = static frame). */
  columns?: number;
  /** Sprite-sheet grid rows (defaults to 1 = static frame). */
  rows?: number;
  /** Optional named animation clips mapped to rows in the sprite sheet. */
  animations?: Record<string, SpriteAnimationClip>;
  /** Optional initial clip name to activate on creation. */
  initialAnimation?: string;
  /**
   * When true (default for multi-frame sheets), clones the texture handle so
   * multiple sprites sharing the same cached image maintain independent UV frames.
   */
  cloneTextureForSheet?: boolean;
}

/**
 * 2D paper-cutout sprite standing vertically on the 3D plane.
 * Uses `alphaTest` cutout transparency + `customDepthMaterial` so sprites
 * receive scene lighting, avoid Z-sorting glitches, and cast crisp silhouette shadows.
 * Supports both single-frame SVG textures and multi-frame UV sprite sheets.
 */
export class PaperSprite {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  readonly texture: THREE.Texture;

  private readonly flipDuration: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly animations: Record<string, SpriteAnimationClip>;
  private readonly baseMeshY: number;
  private readonly uvRight = new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2);
  private readonly uvLeft = new THREE.BufferAttribute(new Float32Array([1, 1, 0, 1, 1, 0, 0, 0]), 2);

  private facing: FacingDirection = 'front';
  private facingRight = true;
  private mirroredUv = false;
  private flipProgress = 0; // 0 = facing right, 1 = facing left (swaps UV at edge-on 0.5)
  private walkTime = 0;
  private isMoving = false;

  private currentAnimationName: string | null = null;
  private currentFrame = 0;
  private frameTimer = 0;

  constructor(options: PaperSpriteOptions) {
    const aspect = options.aspectRatio ?? 1.0;
    const width = options.worldHeight * aspect;
    const height = options.worldHeight;
    const alphaTest = options.alphaTest ?? 0.5;
    this.flipDuration = options.flipDuration ?? 0.14;
    this.columns = Math.max(1, Math.floor(options.columns ?? 1));
    this.rows = Math.max(1, Math.floor(options.rows ?? 1));
    this.animations = options.animations ? { ...options.animations } : {};

    const isSheet = this.columns > 1 || this.rows > 1;
    if (isSheet && (options.cloneTextureForSheet ?? true)) {
      this.texture = options.texture.clone();
      this.texture.needsUpdate = true;
    } else {
      this.texture = options.texture;
    }

    if (isSheet) {
      this.texture.repeat.set(1 / this.columns, 1 / this.rows);
      this.applyUvFrame(0, 0);
    }

    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.setAttribute('uv', this.uvRight);
    this.baseMeshY = height * 0.5 - (options.groundOffset ?? 0);

    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      alphaTest,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
    });

    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: this.texture,
      alphaTest,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = this.baseMeshY;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;

    this.root.add(this.mesh);

    if (options.initialAnimation && this.animations[options.initialAnimation]) {
      this.playAnimation(options.initialAnimation, { restart: true });
    } else if (this.animations.idle) {
      this.playAnimation('idle', { restart: true });
    }
  }

  setPosition(x: number, z: number): void {
    this.root.position.set(x, 0, z);
  }

  getPosition(): { x: number; z: number } {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  setFacing(direction: FacingDirection): void {
    this.facing = direction;
    if (direction === 'right') {
      this.facingRight = true;
    } else if (direction === 'left') {
      this.facingRight = false;
    }
  }

  getFacing(): FacingDirection {
    return this.facing;
  }

  setFacingRight(right: boolean): void {
    this.facingRight = right;
    this.facing = right ? 'right' : 'left';
  }

  isFacingRight(): boolean {
    return this.facingRight;
  }

  setMoving(moving: boolean): void {
    this.isMoving = moving;
  }

  hasAnimation(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.animations, name);
  }

  getCurrentAnimation(): string | null {
    return this.currentAnimationName;
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Activates a named sprite-sheet animation clip. No-op if the clip does not exist
   * or is already playing (unless `restart: true`).
   */
  playAnimation(name: string, options: { restart?: boolean } = {}): boolean {
    const clip = this.animations[name];
    if (!clip) return false;
    if (this.currentAnimationName === name && !options.restart) {
      return true;
    }

    this.currentAnimationName = name;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.applyUvFrame(0, clip.row);
    return true;
  }

  /** Directly selects a `(col, row)` cell on a sprite sheet, syncing both material and shadow depth map. */
  setSheetFrame(col: number, row: number): void {
    const clampedCol = Math.max(0, Math.min(this.columns - 1, Math.floor(col)));
    const clampedRow = Math.max(0, Math.min(this.rows - 1, Math.floor(row)));
    this.currentFrame = clampedCol;
    this.applyUvFrame(clampedCol, clampedRow);
  }

  private applyUvFrame(col: number, row: number): void {
    if (this.columns <= 1 && this.rows <= 1) return;
    // Row 0 is the top row of the image; Three.js UV origin (0,0) is bottom-left.
    const u = col / this.columns;
    const v = 1 - (row + 1) / this.rows;
    this.texture.offset.set(u, v);
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
    // 1. Multi-frame sprite-sheet UV playback
    if (this.currentAnimationName) {
      const clip = this.animations[this.currentAnimationName];
      if (clip && clip.frames > 1 && clip.fps > 0) {
        this.frameTimer += dt;
        const frameDuration = 1 / clip.fps;
        if (this.frameTimer >= frameDuration) {
          const steps = Math.floor(this.frameTimer / frameDuration);
          this.frameTimer -= steps * frameDuration;
          const nextFrame = this.currentFrame + steps;
          if (clip.loop) {
            this.currentFrame = nextFrame % clip.frames;
          } else {
            this.currentFrame = Math.min(clip.frames - 1, nextFrame);
          }
          this.applyUvFrame(this.currentFrame, clip.row);
        }
      }
    }

    // 2. Smooth horizontal paper-flip tween:
    // Spins 0 -> +PI/2 (edge-on), mirrors UVs while edge-on, then completes -PI/2 -> 0
    // so the lit front face (+Z normal) ALWAYS faces the camera & lights (zero shadowy backface).
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
      const shouldMirror = t >= 0.5;
      if (shouldMirror !== this.mirroredUv) {
        this.mirroredUv = shouldMirror;
        this.mesh.geometry.setAttribute('uv', shouldMirror ? this.uvLeft : this.uvRight);
      }
      this.mesh.rotation.y = shouldMirror ? (t - 1) * Math.PI : t * Math.PI;
    }

    // 3. Subtle procedural walk bob + slight paper tilt while moving
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
