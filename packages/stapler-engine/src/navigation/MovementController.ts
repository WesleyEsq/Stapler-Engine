import * as THREE from 'three';
import type { Vec2 } from '../types/contracts';
import type { PaperSprite } from '../render/PaperSprite';
import type { NavGrid } from './NavGrid';
import { Pathfinder } from './Pathfinder';
import {
  getTargetPos,
  type InteractableTarget,
  type InteractionSystem,
} from './InteractionSystem';

export interface MovementControllerOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  floorMesh: THREE.Mesh;
  sprite: PaperSprite;
  navGrid: NavGrid;
  interactions: InteractionSystem;
  moveSpeed?: number;
  agentRadius?: number;
  /** Called whenever the active click-to-move path changes (for DebugOverlay). */
  onPathChanged?: (waypoints: readonly Vec2[]) => void;
  /** Called whenever the hovered interactable under the pointer changes. */
  onHoverChanged?: (target: InteractableTarget | null) => void;
  /** Called whenever the nearest Spacebar-range interactable changes. */
  onNearestChanged?: (target: InteractableTarget | null) => void;
}

/**
 * Milestone 2 hybrid movement & interaction controller:
 * - WASD / Arrow keys: smooth float movement with separate X/Z NavGrid + AABB + NPC sliding.
 * - Point-and-click: 8-way A* with radius-aware string-pulling; clicking an interactable
 *   walks into its `interactionRadius` and activates it on arrival.
 * - Spacebar: interacts with the nearest interactable within range (with facing bias).
 * - Pointer hover cursor & proximity callbacks for UI cues.
 */
export class MovementController {
  readonly clickMarker: THREE.Mesh;

  private readonly domElement: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly floorMesh: THREE.Mesh;
  private readonly sprite: PaperSprite;
  private readonly navGrid: NavGrid;
  private readonly interactions: InteractionSystem;
  private readonly moveSpeed: number;
  private readonly agentRadius: number;
  private readonly onPathChanged?: (waypoints: readonly Vec2[]) => void;
  private readonly onHoverChanged?: (target: InteractableTarget | null) => void;
  private readonly onNearestChanged?: (target: InteractableTarget | null) => void;

  private readonly keysDown = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private waypoints: Vec2[] = [];
  private pendingInteractable: InteractableTarget | null = null;
  private hoveredInteractable: InteractableTarget | null = null;
  private nearestInteractable: InteractableTarget | null = null;
  private lastFacingVec: Vec2 = { x: 1, z: 0 };
  private markerPulse = 0;
  private enabled = true;
  private interactCooldown = 0;

  constructor(options: MovementControllerOptions) {
    this.domElement = options.domElement;
    this.camera = options.camera;
    this.floorMesh = options.floorMesh;
    this.sprite = options.sprite;
    this.navGrid = options.navGrid;
    this.interactions = options.interactions;
    this.moveSpeed = options.moveSpeed ?? 4.4;
    this.agentRadius = options.agentRadius ?? 0.28;
    this.onPathChanged = options.onPathChanged;
    this.onHoverChanged = options.onHoverChanged;
    this.onNearestChanged = options.onNearestChanged;

    const ringGeo = new THREE.RingGeometry(0.16, 0.24, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6b4a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.clickMarker = new THREE.Mesh(ringGeo, ringMat);
    this.clickMarker.position.y = 0.025;
    this.clickMarker.visible = false;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointermove', this.onPointerMove);
  }

  setEnabled(enabled: boolean, options: { interactCooldownSec?: number } = {}): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keysDown.clear();
      this.cancelPath();
      this.setHovered(null);
      this.sprite.setMoving(false);
    } else if (options.interactCooldownSec && options.interactCooldownSec > 0) {
      this.interactCooldown = Math.max(this.interactCooldown, options.interactCooldownSec);
    }
  }

  cancelPath(): void {
    this.waypoints = [];
    this.pendingInteractable = null;
    this.clickMarker.visible = false;
    this.onPathChanged?.([]);
  }

  getNearestInteractable(): InteractableTarget | null {
    return this.nearestInteractable;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    const code = e.code;

    if (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      this.keysDown.add(code);
      this.cancelPath();
      return;
    }

    if (code === 'Space' && !e.repeat) {
      if (this.interactCooldown > 0) return;
      const pos = this.sprite.getPosition();
      const target = this.interactions.findNearestInteractable(
        pos.x,
        pos.z,
        this.lastFacingVec.x,
        this.lastFacingVec.z,
      );
      if (target) {
        e.preventDefault();
        this.cancelPath();
        this.interactions.activateInteractable(target);
      }
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const target = this.raycastInteractable(e);
    this.setHovered(target);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button !== 0) return;

    const pos = this.sprite.getPosition();

    // 1. Check clickable interactables first
    const clickedTarget = this.raycastInteractable(e);
    if (clickedTarget) {
      const tPos = getTargetPos(clickedTarget);
      const dist = Math.hypot(tPos.x - pos.x, tPos.z - pos.z);
      if (dist <= clickedTarget.interactionRadius) {
        this.cancelPath();
        this.interactions.activateInteractable(clickedTarget);
        return;
      }

      const approach = this.interactions.findApproachPoint(
        this.navGrid,
        pos,
        clickedTarget,
        this.agentRadius,
      );
      if (!approach) return;

      const path = Pathfinder.findPath(this.navGrid, pos, approach, {
        agentRadius: this.agentRadius,
        smooth: true,
      });
      if (path.length > 0) {
        this.waypoints = path;
        this.pendingInteractable = clickedTarget;
        const end = path[path.length - 1]!;
        this.clickMarker.position.set(end.x, 0.025, end.z);
        this.clickMarker.visible = true;
        this.markerPulse = 0;
        this.onPathChanged?.([pos, ...path]);
      }
      return;
    }

    // 2. Otherwise raycast against floor plane
    this.updatePointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.floorMesh, false);
    const hit = hits[0];
    if (!hit) return;

    const path = Pathfinder.findPath(
      this.navGrid,
      pos,
      { x: hit.point.x, z: hit.point.z },
      { agentRadius: this.agentRadius, smooth: true },
    );
    if (path.length === 0) return;

    this.waypoints = path;
    this.pendingInteractable = null;
    const end = path[path.length - 1]!;
    this.clickMarker.position.set(end.x, 0.025, end.z);
    this.clickMarker.visible = true;
    this.markerPulse = 0;
    this.onPathChanged?.([pos, ...path]);
  };

  update(dt: number): void {
    const pos = this.sprite.getPosition();

    if (this.interactCooldown > 0) {
      this.interactCooldown = Math.max(0, this.interactCooldown - dt);
    }

    if (!this.enabled) {
      this.sprite.setMoving(false);
      this.sprite.playAnimation('idle');
      return;
    }

    let dx = 0;
    let dz = 0;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) dx -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) dx += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) dz -= 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) dz += 1;

    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      const dirX = dx / len;
      const dirZ = dz / len;
      const next = this.navGrid.moveWithSlide(
        pos.x,
        pos.z,
        dirX * this.moveSpeed * dt,
        dirZ * this.moveSpeed * dt,
        this.agentRadius,
      );
      const moved = Math.hypot(next.x - pos.x, next.z - pos.z) > 1e-4;
      this.sprite.setPosition(next.x, next.z);
      this.lastFacingVec = { x: dirX, z: dirZ };
      this.updateSpriteFacing(dirX, dirZ);
      this.applyMovementAnimation(moved, dirZ);
      this.afterPositionUpdate(next.x, next.z);
      return;
    }

    if (this.waypoints.length > 0) {
      // If approaching a moving interactable and already within range, trigger immediately
      if (this.pendingInteractable) {
        const tPos = getTargetPos(this.pendingInteractable);
        if (Math.hypot(tPos.x - pos.x, tPos.z - pos.z) <= this.pendingInteractable.interactionRadius) {
          const toActivate = this.pendingInteractable;
          this.cancelPath();
          this.sprite.setMoving(false);
          this.sprite.playAnimation('idle');
          this.interactions.activateInteractable(toActivate);
          this.afterPositionUpdate(pos.x, pos.z);
          return;
        }
      }

      const target = this.waypoints[0]!;
      const toX = target.x - pos.x;
      const toZ = target.z - pos.z;
      const dist = Math.hypot(toX, toZ);
      const step = this.moveSpeed * dt;

      if (dist <= step || dist < 0.04) {
        const next = this.navGrid.moveWithSlide(pos.x, pos.z, toX, toZ, this.agentRadius);
        this.sprite.setPosition(next.x, next.z);
        this.waypoints.shift();
        this.onPathChanged?.(this.waypoints.length > 0 ? [next, ...this.waypoints] : []);

        if (this.waypoints.length === 0) {
          const toActivate = this.pendingInteractable;
          this.pendingInteractable = null;
          this.clickMarker.visible = false;
          this.sprite.setMoving(false);
          this.sprite.playAnimation('idle');
          if (toActivate) {
            const tPos = getTargetPos(toActivate);
            if (Math.hypot(tPos.x - next.x, tPos.z - next.z) <= toActivate.interactionRadius + 0.35) {
              this.interactions.activateInteractable(toActivate);
            }
          }
        }
        this.afterPositionUpdate(next.x, next.z);
        return;
      }

      const dirX = toX / dist;
      const dirZ = toZ / dist;
      const next = this.navGrid.moveWithSlide(
        pos.x,
        pos.z,
        dirX * step,
        dirZ * step,
        this.agentRadius,
      );
      const movedDist = Math.hypot(next.x - pos.x, next.z - pos.z);

      // If blocked (e.g. an NPC stepped into our path), stop cleanly rather than jittering
      if (movedDist < step * 0.08) {
        this.cancelPath();
        this.sprite.setMoving(false);
        this.sprite.playAnimation('idle');
        this.afterPositionUpdate(pos.x, pos.z);
        return;
      }

      this.sprite.setPosition(next.x, next.z);
      this.lastFacingVec = { x: dirX, z: dirZ };
      this.updateSpriteFacing(dirX, dirZ);
      this.applyMovementAnimation(true, dirZ);

      this.markerPulse += dt * 6;
      const s = 1 + Math.sin(this.markerPulse) * 0.14;
      this.clickMarker.scale.set(s, s, s);

      this.afterPositionUpdate(next.x, next.z);
      return;
    }

    this.sprite.setMoving(false);
    this.sprite.playAnimation('idle');
    this.afterPositionUpdate(pos.x, pos.z);
  }

  private updateSpriteFacing(dirX: number, dirZ: number): void {
    if (Math.abs(dirX) >= Math.abs(dirZ) && Math.abs(dirX) > 0.04) {
      this.sprite.setFacing(dirX > 0 ? 'right' : 'left');
    } else if (Math.abs(dirZ) > 0.04) {
      if (Math.abs(dirX) > 0.08) {
        this.sprite.setFacingRight(dirX > 0);
      }
      this.sprite.setFacing(dirZ < 0 ? 'back' : 'front');
    }
  }

  private applyMovementAnimation(moving: boolean, dirZ: number): void {
    this.sprite.setMoving(moving);
    if (!moving) {
      this.sprite.playAnimation('idle');
      return;
    }
    if (dirZ < -0.5 && this.sprite.hasAnimation('walk_back')) {
      this.sprite.playAnimation('walk_back');
    } else if (this.sprite.hasAnimation('walk_front')) {
      this.sprite.playAnimation('walk_front');
    }
  }

  private afterPositionUpdate(x: number, z: number): void {
    this.interactions.updatePlayerPosition(x, z);

    const nearest = this.interactions.findNearestInteractable(
      x,
      z,
      this.lastFacingVec.x,
      this.lastFacingVec.z,
    );
    if (nearest?.id !== this.nearestInteractable?.id) {
      this.nearestInteractable = nearest;
      this.onNearestChanged?.(nearest);
    }
  }

  private setHovered(target: InteractableTarget | null): void {
    if (target?.id === this.hoveredInteractable?.id) return;
    this.hoveredInteractable = target;
    this.domElement.style.cursor = target ? 'pointer' : 'crosshair';
    this.onHoverChanged?.(target);
  }

  private raycastInteractable(e: PointerEvent): InteractableTarget | null {
    const hitboxes = this.interactions.getHitboxObjects();
    if (hitboxes.length === 0) return null;

    this.updatePointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(hitboxes, true);
    for (const hit of hits) {
      const target = this.interactions.findInteractableByObject(hit.object);
      if (target) return target;
    }
    return null;
  }

  private updatePointerNdc(e: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.style.cursor = '';
  }
}
