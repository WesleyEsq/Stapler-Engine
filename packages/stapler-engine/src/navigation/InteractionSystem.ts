import type * as THREE from 'three';
import type { Aabb2D, FacingDirection, TriggerMode, Vec2 } from '../types/contracts';
import type { NavGrid } from './NavGrid';

export interface InteractableTarget {
  id: string;
  label?: string;
  kind: 'npc' | 'trigger' | 'prop';
  x: number;
  z: number;
  /** Live position getter (used for moving NPCs); overrides static x/z when provided. */
  getPosition?: () => Vec2;
  interactionRadius: number;
  /** Optional Three.js object root for pointer raycast matching. */
  hitbox?: THREE.Object3D;
  enabled?: boolean;
  /** Optional metadata for scene transitions or dialogue scripts. */
  targetEnv?: string;
  targetSpawnId?: string;
  facing?: FacingDirection;
  scriptId?: string;
  onInteract?: (target: InteractableTarget) => void;
}

export interface WalkOverZone {
  id: string;
  label?: string;
  bounds: Aabb2D;
  oneShot: boolean;
  enabled?: boolean;
  targetEnv?: string;
  targetSpawnId?: string;
  facing?: FacingDirection;
  scriptId?: string;
  onEnter?: (zone: WalkOverZone) => void;
}

export interface TriggerFiredEvent {
  mode: TriggerMode;
  id: string;
  label?: string;
  targetEnv?: string;
  targetSpawnId?: string;
  facing?: FacingDirection;
  scriptId?: string;
}

/**
 * Manages both walk-over (`enter`) zone triggers and clickable / Spacebar-activatable
 * (`interact`) targets (doors, props, NPCs), plus approach-point resolution.
 */
export class InteractionSystem {
  private readonly interactables = new Map<string, InteractableTarget>();
  private readonly zones = new Map<string, WalkOverZone>();
  private readonly insideZones = new Set<string>();
  private readonly firedOneShots = new Set<string>();
  private readonly onTriggerFired?: (event: TriggerFiredEvent) => void;

  constructor(options: { onTriggerFired?: (event: TriggerFiredEvent) => void } = {}) {
    this.onTriggerFired = options.onTriggerFired;
  }

  registerInteractable(target: InteractableTarget): void {
    this.interactables.set(target.id, { enabled: true, ...target });
  }

  unregisterInteractable(id: string): void {
    this.interactables.delete(id);
  }

  getInteractable(id: string): InteractableTarget | undefined {
    return this.interactables.get(id);
  }

  getInteractables(): InteractableTarget[] {
    return Array.from(this.interactables.values());
  }

  getHitboxObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const item of this.interactables.values()) {
      if (item.enabled !== false && item.hitbox) {
        objects.push(item.hitbox);
      }
    }
    return objects;
  }

  registerZone(zone: WalkOverZone): void {
    this.zones.set(zone.id, { enabled: true, ...zone });
  }

  unregisterZone(id: string): void {
    this.zones.delete(id);
    this.insideZones.delete(id);
    this.firedOneShots.delete(id);
  }

  getZones(): WalkOverZone[] {
    return Array.from(this.zones.values());
  }

  /**
   * Marks any zones the player starts inside as already entered so spawning
   * on top of a doorway or zone does not immediately re-trigger a warp.
   */
  seedInitialPosition(x: number, z: number): void {
    this.insideZones.clear();
    for (const zone of this.zones.values()) {
      if (pointInAabb(x, z, zone.bounds)) {
        this.insideZones.add(zone.id);
      }
    }
  }

  /**
   * Evaluates walk-over (`enter`) zones for the current player position.
   * Fires only on edge entry (`outside -> inside`) and respects `oneShot`.
   */
  updatePlayerPosition(x: number, z: number): TriggerFiredEvent[] {
    const fired: TriggerFiredEvent[] = [];

    for (const zone of this.zones.values()) {
      if (zone.enabled === false) {
        this.insideZones.delete(zone.id);
        continue;
      }

      const inside = pointInAabb(x, z, zone.bounds);
      const wasInside = this.insideZones.has(zone.id);

      if (inside && !wasInside) {
        this.insideZones.add(zone.id);
        if (zone.oneShot && this.firedOneShots.has(zone.id)) {
          continue;
        }
        if (zone.oneShot) {
          this.firedOneShots.add(zone.id);
        }

        const event: TriggerFiredEvent = {
          mode: 'enter',
          id: zone.id,
          label: zone.label,
          targetEnv: zone.targetEnv,
          targetSpawnId: zone.targetSpawnId,
          facing: zone.facing,
          scriptId: zone.scriptId,
        };
        zone.onEnter?.(zone);
        this.onTriggerFired?.(event);
        fired.push(event);
      } else if (!inside && wasInside) {
        this.insideZones.delete(zone.id);
      }
    }

    return fired;
  }

  /** Resolves a raycasted Three.js object (walking up ancestors) to its registered interactable. */
  findInteractableByObject(hitObject: THREE.Object3D): InteractableTarget | null {
    let cursor: THREE.Object3D | null = hitObject;
    while (cursor) {
      for (const item of this.interactables.values()) {
        if (item.enabled !== false && item.hitbox === cursor) {
          return item;
        }
      }
      cursor = cursor.parent;
    }
    return null;
  }

  /**
   * Finds the best interactable within its own `interactionRadius`, applying a
   * small directional bias toward the player's facing vector `(facingX, facingZ)`.
   */
  findNearestInteractable(
    playerX: number,
    playerZ: number,
    facingX = 0,
    facingZ = 0,
  ): InteractableTarget | null {
    const facingLen = Math.hypot(facingX, facingZ);
    const fx = facingLen > 1e-5 ? facingX / facingLen : 0;
    const fz = facingLen > 1e-5 ? facingZ / facingLen : 0;

    let best: InteractableTarget | null = null;
    let bestScore = Infinity;

    for (const item of this.interactables.values()) {
      if (item.enabled === false) continue;
      const pos = getTargetPos(item);
      const dx = pos.x - playerX;
      const dz = pos.z - playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist > item.interactionRadius) continue;

      let score = dist;
      if (facingLen > 1e-5 && dist > 1e-5) {
        const dot = (dx / dist) * fx + (dz / dist) * fz;
        // Favor targets in front of the player by up to 0.25 tiles
        score -= dot * 0.25;
      }

      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }

    return best;
  }

  /** Fires an interactable target's callback and notifies the system trigger listener. */
  activateInteractable(target: InteractableTarget): TriggerFiredEvent {
    const event: TriggerFiredEvent = {
      mode: 'interact',
      id: target.id,
      label: target.label,
      targetEnv: target.targetEnv,
      targetSpawnId: target.targetSpawnId,
      facing: target.facing,
      scriptId: target.scriptId,
    };
    target.onInteract?.(target);
    this.onTriggerFired?.(event);
    return event;
  }

  /**
   * Computes a walkable goal position within `target.interactionRadius` closest
   * to the player so clicking a blocked door/NPC walks cleanly up to it.
   */
  findApproachPoint(
    grid: NavGrid,
    playerPos: Vec2,
    target: InteractableTarget,
    agentRadius = 0.28,
  ): Vec2 | null {
    const pos = getTargetPos(target);
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= target.interactionRadius) {
      return { x: playerPos.x, z: playerPos.z };
    }

    // Try a spot slightly inside interactionRadius on the vector toward the player
    const desiredDist = Math.max(0.55, target.interactionRadius * 0.72);
    const dirX = dist > 1e-5 ? dx / dist : 0;
    const dirZ = dist > 1e-5 ? dz / dist : 1;
    const directCandidate = {
      x: pos.x + dirX * desiredDist,
      z: pos.z + dirZ * desiredDist,
    };
    if (!grid.isBlockedAt(directCandidate.x, directCandidate.z, agentRadius, { ignoreCircles: true })) {
      return directCandidate;
    }

    // Otherwise sample 8 directions around the target within interactionRadius
    let best: Vec2 | null = null;
    let bestPlayerDistSq = Infinity;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI) / 4;
      const cx = pos.x + Math.cos(angle) * desiredDist;
      const cz = pos.z + Math.sin(angle) * desiredDist;
      if (grid.isBlockedAt(cx, cz, agentRadius, { ignoreCircles: true })) continue;
      const pDistSq = (cx - playerPos.x) * (cx - playerPos.x) + (cz - playerPos.z) * (cz - playerPos.z);
      if (pDistSq < bestPlayerDistSq) {
        bestPlayerDistSq = pDistSq;
        best = { x: cx, z: cz };
      }
    }

    if (best) return best;
    return grid.findNearestWalkablePoint(pos.x, pos.z, agentRadius, 3);
  }

  clear(): void {
    this.interactables.clear();
    this.zones.clear();
    this.insideZones.clear();
    this.firedOneShots.clear();
  }
}

export function getTargetPos(target: InteractableTarget): Vec2 {
  return target.getPosition ? target.getPosition() : { x: target.x, z: target.z };
}

function pointInAabb(x: number, z: number, box: Aabb2D): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}
