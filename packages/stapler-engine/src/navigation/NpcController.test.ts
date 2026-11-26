import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PaperSprite } from '../render/PaperSprite';
import { NavGrid } from './NavGrid';
import { NpcController } from './NpcController';

function createTestSprite(x: number, z: number): PaperSprite {
  const sprite = new PaperSprite({
    texture: new THREE.Texture(),
    worldHeight: 2.0,
    columns: 4,
    rows: 2,
    animations: {
      idle: { row: 0, frames: 1, fps: 1, loop: true },
      walk_front: { row: 0, frames: 4, fps: 8, loop: true },
      walk_back: { row: 1, frames: 4, fps: 8, loop: true },
    },
  });
  sprite.setPosition(x, z);
  return sprite;
}

describe('NpcController', () => {
  it('follows pingpong waypoints with wait pauses and keeps NavGrid circle blocker synced', () => {
    const grid = new NavGrid(10, 10);
    const controller = new NpcController({ navGrid: grid });
    const sprite = createTestSprite(2, 5);

    controller.addNpc({
      id: 'ada',
      sprite,
      patrolPath: [
        { x: 2, z: 5 },
        { x: 4, z: 5 },
      ],
      patrolMode: 'pingpong',
      moveSpeed: 2.0,
      waitAtWaypointSec: 0.5,
      solidRadius: 0.3,
    });

    const farPlayer = { x: 9, z: 9 };

    // 1.0s at speed 2.0 moves from x=2 -> x=4
    for (let i = 0; i < 20; i += 1) {
      controller.update(0.05, { mode: 'EXPLORE', playerPos: farPlayer });
    }
    expect(sprite.getPosition().x).toBeCloseTo(4, 2);

    // NavGrid circle blocker moved along with the NPC
    expect(grid.isBlockedAt(4.0, 5.0, 0.28)).toBe(true);
    expect(grid.isBlockedAt(2.0, 5.0, 0.28)).toBe(false);

    // Wait 0.4s (< 0.5s waitAtWaypointSec) => still paused at x=4
    for (let i = 0; i < 8; i += 1) {
      controller.update(0.05, { mode: 'EXPLORE', playerPos: farPlayer });
    }
    expect(sprite.getPosition().x).toBeCloseTo(4, 2);

    // Step another 1.1s => finishes wait and heads back toward x=2
    for (let i = 0; i < 22; i += 1) {
      controller.update(0.05, { mode: 'EXPLORE', playerPos: farPlayer });
    }
    expect(sprite.getPosition().x).toBeCloseTo(2, 2);
    expect(sprite.isFacingRight()).toBe(false);
  });

  it('pauses patrol when mode is not EXPLORE or when player blocks the path', () => {
    const controller = new NpcController();
    const sprite = createTestSprite(2, 2);

    controller.addNpc({
      id: 'student',
      sprite,
      patrolPath: [
        { x: 2, z: 2 },
        { x: 6, z: 2 },
      ],
      patrolMode: 'once',
      moveSpeed: 2.0,
      waitAtWaypointSec: 0,
      solidRadius: 0.3,
    });

    // In DIALOGUE mode, NPC must stay frozen
    controller.update(0.5, { mode: 'DIALOGUE', playerPos: { x: 9, z: 9 } });
    expect(sprite.getPosition().x).toBeCloseTo(2, 5);

    // Player standing directly in front of NPC at x=2.6 causes polite yield
    controller.update(0.05, { mode: 'EXPLORE', playerPos: { x: 2.6, z: 2 } });
    expect(sprite.getPosition().x).toBeCloseTo(2, 5);

    // Once player moves away, NPC finishes 'once' patrol and stops at x=6
    for (let i = 0; i < 50; i += 1) {
      controller.update(0.05, { mode: 'EXPLORE', playerPos: { x: 9, z: 9 } });
    }
    expect(sprite.getPosition().x).toBeCloseTo(6, 2);

    // Extra time does not move past final waypoint in 'once' mode
    controller.update(0.5, { mode: 'EXPLORE', playerPos: { x: 9, z: 9 } });
    expect(sprite.getPosition().x).toBeCloseTo(6, 2);
  });

  it('pauses and faces the player on beginInteraction, then resumes on endInteraction', () => {
    const controller = new NpcController();
    const sprite = createTestSprite(5, 5);
    sprite.setFacingRight(true);

    controller.addNpc({
      id: 'unua',
      sprite,
      patrolPath: [
        { x: 5, z: 5 },
        { x: 8, z: 5 },
      ],
      patrolMode: 'loop',
      moveSpeed: 2.0,
      waitAtWaypointSec: 0,
    });

    controller.beginInteraction('unua', { x: 3, z: 5 });
    expect(sprite.isFacingRight()).toBe(false);

    controller.update(0.5, { mode: 'EXPLORE', playerPos: { x: 3, z: 5 } });
    expect(sprite.getPosition().x).toBeCloseTo(5, 5);

    controller.endInteraction('unua');
    controller.update(0.5, { mode: 'EXPLORE', playerPos: { x: 1, z: 1 } });
    expect(sprite.getPosition().x).toBeGreaterThan(5.5);
  });

  it('switches a north-facing NPC from walk_back to idle_back when dialogue pauses patrol', () => {
    const controller = new NpcController();
    const sprite = new PaperSprite({
      texture: new THREE.Texture(),
      worldHeight: 2.0,
      columns: 4,
      rows: 4,
      animations: {
        idle: { row: 0, frames: 1, fps: 1, loop: true },
        walk_front: { row: 1, frames: 4, fps: 8, loop: true },
        idle_back: { row: 2, frames: 1, fps: 1, loop: true },
        walk_back: { row: 3, frames: 4, fps: 8, loop: true },
      },
    });
    sprite.setPosition(5, 6);

    controller.addNpc({
      id: 'walker',
      sprite,
      patrolPath: [
        { x: 5, z: 6 },
        { x: 5, z: 2 },
      ],
      patrolMode: 'once',
      moveSpeed: 2.0,
      waitAtWaypointSec: 0,
    });

    controller.update(0.2, { mode: 'EXPLORE', playerPos: { x: 1, z: 1 } });
    expect(sprite.getFacing()).toBe('back');
    expect(sprite.getCurrentAnimation()).toBe('walk_back');

    controller.update(0.1, { mode: 'DIALOGUE', playerPos: { x: 1, z: 1 } });
    expect(sprite.getCurrentAnimation()).toBe('idle_back');
  });
});
