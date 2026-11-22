import type { EngineMode, PatrolMode, Vec2 } from '../types/contracts';
import type { PaperSprite } from '../render/PaperSprite';
import type { NavGrid } from './NavGrid';

export interface NpcAgentOptions {
  id: string;
  sprite: PaperSprite;
  patrolPath?: readonly Vec2[];
  patrolMode?: PatrolMode;
  moveSpeed?: number;
  waitAtWaypointSec?: number;
  /** Solid circle collision radius registered in NavGrid (0 disables blocking). */
  solidRadius?: number;
}

export interface NpcUpdateContext {
  mode: EngineMode;
  playerPos: Vec2;
  playerRadius?: number;
}

interface NpcRuntime {
  id: string;
  sprite: PaperSprite;
  waypoints: Vec2[];
  patrolMode: PatrolMode;
  moveSpeed: number;
  waitAtWaypointSec: number;
  solidRadius: number;
  waypointIndex: number;
  direction: 1 | -1;
  waitTimer: number;
  completedOnce: boolean;
  interacting: boolean;
}

/**
 * Drives scene NPCs: handles animated idle states, designated waypoint patrols
 * (`loop`, `pingpong`, `once` with configurable pauses), NavGrid solid circle
 * registration, player yielding, and auto-pause/face-player during interactions.
 */
export class NpcController {
  private readonly npcs = new Map<string, NpcRuntime>();
  private readonly navGrid?: NavGrid;

  constructor(options: { navGrid?: NavGrid } = {}) {
    this.navGrid = options.navGrid;
  }

  addNpc(options: NpcAgentOptions): void {
    const waypoints = options.patrolPath ? options.patrolPath.map((p) => ({ x: p.x, z: p.z })) : [];
    const solidRadius = options.solidRadius ?? 0.3;
    const runtime: NpcRuntime = {
      id: options.id,
      sprite: options.sprite,
      waypoints,
      patrolMode: options.patrolMode ?? 'pingpong',
      moveSpeed: options.moveSpeed ?? 2.2,
      waitAtWaypointSec: options.waitAtWaypointSec ?? 0.8,
      solidRadius,
      waypointIndex: waypoints.length > 1 ? 1 : 0,
      direction: 1,
      waitTimer: 0,
      completedOnce: false,
      interacting: false,
    };

    this.npcs.set(options.id, runtime);
    this.syncCollider(runtime);
  }

  removeNpc(id: string): void {
    this.npcs.delete(id);
    this.navGrid?.removeCircleBlocker(`npc:${id}`);
  }

  getNpcPosition(id: string): Vec2 | undefined {
    return this.npcs.get(id)?.sprite.getPosition();
  }

  /** Pauses an NPC's patrol and turns them horizontally toward the player. */
  beginInteraction(id: string, playerPos: Vec2): void {
    const npc = this.npcs.get(id);
    if (!npc) return;
    npc.interacting = true;
    const pos = npc.sprite.getPosition();
    if (Math.abs(playerPos.x - pos.x) > 0.02) {
      npc.sprite.setFacingRight(playerPos.x > pos.x);
    }
    npc.sprite.setMoving(false);
    npc.sprite.playAnimation('idle');
  }

  /** Resumes an NPC's patrol after dialogue/interaction finishes. */
  endInteraction(id: string): void {
    const npc = this.npcs.get(id);
    if (!npc) return;
    npc.interacting = false;
  }

  update(dt: number, ctx: NpcUpdateContext): void {
    const playerRadius = ctx.playerRadius ?? 0.28;

    for (const npc of this.npcs.values()) {
      const canPatrol =
        ctx.mode === 'EXPLORE' &&
        !npc.interacting &&
        npc.waypoints.length >= 2 &&
        !npc.completedOnce;

      if (!canPatrol) {
        npc.sprite.setMoving(false);
        npc.sprite.playAnimation('idle');
        npc.sprite.update(dt);
        continue;
      }

      let moveDt = dt;
      if (npc.waitTimer > 0) {
        if (npc.waitTimer - dt > 1e-6) {
          npc.waitTimer -= dt;
          npc.sprite.setMoving(false);
          npc.sprite.playAnimation('idle');
          npc.sprite.update(dt);
          continue;
        }
        moveDt = Math.max(0, dt - npc.waitTimer);
        npc.waitTimer = 0;
        if (moveDt <= 1e-6) {
          npc.sprite.setMoving(false);
          npc.sprite.playAnimation('idle');
          npc.sprite.update(dt);
          continue;
        }
      }

      const target = npc.waypoints[npc.waypointIndex];
      if (!target) {
        npc.sprite.setMoving(false);
        npc.sprite.update(dt);
        continue;
      }

      const pos = npc.sprite.getPosition();
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const step = npc.moveSpeed * moveDt;

      if (dist <= step || dist < 0.03) {
        // Snap to waypoint only if player is not occupying it
        if (!this.wouldHitPlayer(target.x, target.z, npc.solidRadius, ctx.playerPos, playerRadius)) {
          npc.sprite.setPosition(target.x, target.z);
          this.syncCollider(npc);
          this.advanceWaypoint(npc);
        }
        npc.sprite.setMoving(false);
        npc.sprite.playAnimation('idle');
        npc.sprite.update(dt);
        continue;
      }

      const dirX = dx / dist;
      const dirZ = dz / dist;
      const nextX = pos.x + dirX * step;
      const nextZ = pos.z + dirZ * step;

      // Politely yield if the player stands directly in the NPC's way
      if (this.wouldHitPlayer(nextX, nextZ, npc.solidRadius, ctx.playerPos, playerRadius + 0.12)) {
        npc.sprite.setMoving(false);
        npc.sprite.playAnimation('idle');
        npc.sprite.update(dt);
        continue;
      }

      npc.sprite.setPosition(nextX, nextZ);
      this.syncCollider(npc);

      if (Math.abs(dirX) > 0.05) {
        npc.sprite.setFacingRight(dirX > 0);
      }
      npc.sprite.setMoving(true);
      if (dirZ < -0.5 && npc.sprite.hasAnimation('walk_back')) {
        npc.sprite.playAnimation('walk_back');
      } else if (npc.sprite.hasAnimation('walk_front')) {
        npc.sprite.playAnimation('walk_front');
      }

      npc.sprite.update(dt);
    }
  }

  private advanceWaypoint(npc: NpcRuntime): void {
    npc.waitTimer = npc.waitAtWaypointSec;
    const last = npc.waypoints.length - 1;

    if (npc.patrolMode === 'loop') {
      npc.waypointIndex = (npc.waypointIndex + 1) % npc.waypoints.length;
      return;
    }

    if (npc.patrolMode === 'once') {
      if (npc.waypointIndex >= last) {
        npc.completedOnce = true;
      } else {
        npc.waypointIndex += 1;
      }
      return;
    }

    // pingpong
    const next = npc.waypointIndex + npc.direction;
    if (next > last) {
      npc.direction = -1;
      npc.waypointIndex = Math.max(0, last - 1);
    } else if (next < 0) {
      npc.direction = 1;
      npc.waypointIndex = Math.min(last, 1);
    } else {
      npc.waypointIndex = next;
    }
  }

  private wouldHitPlayer(
    nx: number,
    nz: number,
    npcRadius: number,
    playerPos: Vec2,
    playerRadius: number,
  ): boolean {
    if (npcRadius <= 0) return false;
    const dx = nx - playerPos.x;
    const dz = nz - playerPos.z;
    const minDist = npcRadius + playerRadius;
    return dx * dx + dz * dz < minDist * minDist;
  }

  private syncCollider(npc: NpcRuntime): void {
    if (!this.navGrid || npc.solidRadius <= 0) return;
    const pos = npc.sprite.getPosition();
    this.navGrid.setCircleBlocker({
      id: `npc:${npc.id}`,
      x: pos.x,
      z: pos.z,
      radius: npc.solidRadius,
    });
  }

  clear(): void {
    for (const id of this.npcs.keys()) {
      this.navGrid?.removeCircleBlocker(`npc:${id}`);
    }
    this.npcs.clear();
  }
}
