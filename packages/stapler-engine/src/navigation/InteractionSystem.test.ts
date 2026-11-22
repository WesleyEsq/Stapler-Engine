import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NavGrid } from './NavGrid';
import { InteractionSystem } from './InteractionSystem';

describe('InteractionSystem', () => {
  it('fires enter zones only on edge entry, respects seedInitialPosition and oneShot', () => {
    const listener = vi.fn();
    const sys = new InteractionSystem({ onTriggerFired: listener });

    sys.registerZone({
      id: 'stairs_fall',
      bounds: { minX: 4, maxX: 6, minZ: 2, maxZ: 4 },
      oneShot: true,
      scriptId: 'stairs_event',
    });

    sys.registerZone({
      id: 'doorway',
      bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      oneShot: false,
      targetEnv: 'hallway',
      targetSpawnId: 'door_a',
    });

    // Player spawns inside doorway => must NOT immediately fire
    sys.seedInitialPosition(1, 1);
    expect(sys.updatePlayerPosition(1.1, 1.1)).toHaveLength(0);

    // Walk outside then back in => fires doorway
    sys.updatePlayerPosition(3, 1);
    const reenter = sys.updatePlayerPosition(1, 1);
    expect(reenter).toHaveLength(1);
    expect(reenter[0]?.id).toBe('doorway');

    // Enter oneShot stairs zone => fires once; leaving and re-entering does NOT fire again
    expect(sys.updatePlayerPosition(5, 3)).toHaveLength(1);
    expect(sys.updatePlayerPosition(5.1, 3.1)).toHaveLength(0);
    sys.updatePlayerPosition(3, 3);
    expect(sys.updatePlayerPosition(5, 3)).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('selects nearest interactable within its radius with facing-direction bias', () => {
    const sys = new InteractionSystem();
    sys.registerInteractable({
      id: 'left_desk',
      kind: 'prop',
      x: 4.0,
      z: 5.0,
      interactionRadius: 1.5,
    });
    sys.registerInteractable({
      id: 'right_npc',
      kind: 'npc',
      x: 6.0,
      z: 5.0,
      interactionRadius: 1.5,
    });

    // Player at (5, 5) equidistant (1.0 tiles) from both; facing right selects right_npc
    expect(sys.findNearestInteractable(5, 5, 1, 0)?.id).toBe('right_npc');
    // Facing left selects left_desk
    expect(sys.findNearestInteractable(5, 5, -1, 0)?.id).toBe('left_desk');
    // Outside both radii returns null
    expect(sys.findNearestInteractable(5, 8, 1, 0)).toBeNull();
  });

  it('resolves child meshes back to their registered hitbox interactable', () => {
    const sys = new InteractionSystem();
    const root = new THREE.Group();
    const childMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    root.add(childMesh);

    sys.registerInteractable({
      id: 'cabinet',
      kind: 'prop',
      x: 2,
      z: 2,
      interactionRadius: 1.25,
      hitbox: root,
    });

    expect(sys.findInteractableByObject(childMesh)?.id).toBe('cabinet');
  });

  it('computes a walkable approach point when clicking an interactable on a blocked tile', () => {
    const grid = new NavGrid(6, 6);
    grid.setTileBlocked(3, 3, true);

    const sys = new InteractionSystem();
    const target = {
      id: 'locked_door',
      kind: 'trigger' as const,
      x: 3.5,
      z: 3.5,
      interactionRadius: 1.3,
    };
    sys.registerInteractable(target);

    const approach = sys.findApproachPoint(grid, { x: 1.5, z: 3.5 }, target, 0.28);
    expect(approach).not.toBeNull();
    expect(grid.isBlockedAt(approach!.x, approach!.z, 0.28, { ignoreCircles: true })).toBe(false);
    expect(Math.hypot(approach!.x - target.x, approach!.z - target.z)).toBeLessThanOrEqual(
      target.interactionRadius,
    );
  });
});
