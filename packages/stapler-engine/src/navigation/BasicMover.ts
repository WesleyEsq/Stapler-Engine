import * as THREE from 'three';
import type { PaperSprite } from '../render/PaperSprite';

export interface BasicMoverOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  floorMesh: THREE.Mesh;
  sprite: PaperSprite;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  moveSpeed?: number;
}

/**
 * Milestone 1 movement controller: supports both WASD/Arrow keys and
 * point-and-click floor targeting with a subtle click marker ring.
 */
export class BasicMover {
  readonly clickMarker: THREE.Mesh;
  private readonly domElement: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly floorMesh: THREE.Mesh;
  private readonly sprite: PaperSprite;
  private readonly bounds: BasicMoverOptions['bounds'];
  private readonly moveSpeed: number;

  private readonly keysDown = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private targetPos: { x: number; z: number } | null = null;
  private markerPulse = 0;

  constructor(options: BasicMoverOptions) {
    this.domElement = options.domElement;
    this.camera = options.camera;
    this.floorMesh = options.floorMesh;
    this.sprite = options.sprite;
    this.bounds = options.bounds;
    this.moveSpeed = options.moveSpeed ?? 4.2;

    const ringGeo = new THREE.RingGeometry(0.16, 0.24, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6b4a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.clickMarker = new THREE.Mesh(ringGeo, ringMat);
    this.clickMarker.position.y = 0.02;
    this.clickMarker.visible = false;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
      code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight'
    ) {
      this.keysDown.add(code);
      this.targetPos = null;
      this.clickMarker.visible = false;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const rect = this.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.floorMesh, false);
    const hit = hits[0];
    if (!hit) return;

    const tx = this.clampX(hit.point.x);
    const tz = this.clampZ(hit.point.z);
    this.targetPos = { x: tx, z: tz };
    this.clickMarker.position.set(tx, 0.02, tz);
    this.clickMarker.visible = true;
    this.markerPulse = 0;
  };

  update(dt: number): void {
    const pos = this.sprite.getPosition();
    let dx = 0;
    let dz = 0;

    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) dx -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) dx += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) dz -= 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) dz += 1;

    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      const vx = (dx / len) * this.moveSpeed * dt;
      const vz = (dz / len) * this.moveSpeed * dt;
      this.sprite.setPosition(this.clampX(pos.x + vx), this.clampZ(pos.z + vz));
      if (dx !== 0) this.sprite.setFacingRight(dx > 0);
      this.sprite.setMoving(true);
      return;
    }

    if (this.targetPos) {
      const toX = this.targetPos.x - pos.x;
      const toZ = this.targetPos.z - pos.z;
      const dist = Math.hypot(toX, toZ);
      const step = this.moveSpeed * dt;

      if (dist <= step || dist < 0.04) {
        this.sprite.setPosition(this.targetPos.x, this.targetPos.z);
        this.targetPos = null;
        this.clickMarker.visible = false;
        this.sprite.setMoving(false);
      } else {
        this.sprite.setPosition(
          this.clampX(pos.x + (toX / dist) * step),
          this.clampZ(pos.z + (toZ / dist) * step),
        );
        if (Math.abs(toX) > 0.02) {
          this.sprite.setFacingRight(toX > 0);
        }
        this.sprite.setMoving(true);

        this.markerPulse += dt * 6;
        const s = 1 + Math.sin(this.markerPulse) * 0.14;
        this.clickMarker.scale.set(s, s, s);
      }
      return;
    }

    this.sprite.setMoving(false);
  }

  private clampX(x: number): number {
    return Math.max(this.bounds.minX, Math.min(this.bounds.maxX, x));
  }

  private clampZ(z: number): number {
    return Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, z));
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
  }
}
