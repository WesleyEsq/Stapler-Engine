import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PaperSprite } from './PaperSprite';

describe('PaperSprite', () => {
  it('enforces alphaTest cutout shadow invariants and groundOffset seating', () => {
    const texture = new THREE.Texture();
    const sprite = new PaperSprite({
      texture,
      worldHeight: 2.0,
      aspectRatio: 1.0,
      alphaTest: 0.45,
      groundOffset: 0.1,
    });

    expect(sprite.material.transparent).toBe(false);
    expect(sprite.material.alphaTest).toBe(0.45);
    expect(sprite.material.side).toBe(THREE.DoubleSide);
    expect(sprite.mesh.castShadow).toBe(true);
    expect(sprite.mesh.customDepthMaterial).toBe(sprite.depthMaterial);
    expect(sprite.depthMaterial.map).toBe(texture);
    expect(sprite.depthMaterial.alphaTest).toBe(0.45);
    expect(sprite.mesh.position.y).toBeCloseTo(0.9, 5);
  });

  it('runs a deterministic horizontal paper-flip tween keeping the lit front face (+Z) forward', () => {
    const sprite = new PaperSprite({
      texture: new THREE.Texture(),
      worldHeight: 2.0,
      flipDuration: 0.14,
    });

    const getFirstU = () => sprite.mesh.geometry.getAttribute('uv').getX(0);

    expect(sprite.mesh.rotation.y).toBe(0);
    expect(getFirstU()).toBe(0);

    sprite.setFacingRight(false);
    sprite.update(0.07); // Halfway => edge-on (|rotY| = PI / 2), UV swaps to mirrored
    expect(Math.abs(sprite.mesh.rotation.y)).toBeCloseTo(Math.PI / 2, 5);
    expect(getFirstU()).toBe(1);

    sprite.update(0.07); // Complete => returns to rotY = 0 (lit front normal) with mirrored UVs
    expect(sprite.mesh.rotation.y).toBeCloseTo(0, 5);
    expect(getFirstU()).toBe(1);

    // Flipping back returns to rotY = 0 with unmirrored UVs
    sprite.setFacingRight(true);
    sprite.update(0.14);
    expect(sprite.mesh.rotation.y).toBeCloseTo(0, 5);
    expect(getFirstU()).toBe(0);
    expect(sprite.getFacing()).toBe('right');

    // Tracks full 4-way facing while keeping horizontal paper-flip state consistent
    sprite.setFacing('left');
    expect(sprite.getFacing()).toBe('left');
    expect(sprite.isFacingRight()).toBe(false);
    sprite.setFacing('back');
    expect(sprite.getFacing()).toBe('back');
    expect(sprite.isFacingRight()).toBe(false);
    sprite.setFacing('front');
    expect(sprite.getFacing()).toBe('front');
  });

  it('applies walk bob while moving and settles cleanly back to rest', () => {
    const sprite = new PaperSprite({
      texture: new THREE.Texture(),
      worldHeight: 2.0,
      groundOffset: 0.05,
    });
    const baseY = 2.0 * 0.5 - 0.05;

    sprite.setMoving(true);
    sprite.update(0.05);
    expect(sprite.mesh.position.y).toBeGreaterThan(baseY);
    expect(sprite.mesh.rotation.z).not.toBe(0);

    sprite.setMoving(false);
    for (let i = 0; i < 30; i += 1) {
      sprite.update(0.05);
    }
    expect(sprite.mesh.position.y).toBeCloseTo(baseY, 3);
    expect(sprite.mesh.rotation.z).toBeCloseTo(0, 3);
  });

  it('toggles flat self-lit rendering on and off', () => {
    const texture = new THREE.Texture();
    const sprite = new PaperSprite({ texture, worldHeight: 2.0 });

    sprite.setFlatLighting(true);
    expect(sprite.material.emissiveMap).toBe(texture);
    expect(sprite.material.emissiveIntensity).toBeGreaterThan(0);

    sprite.setFlatLighting(false);
    expect(sprite.material.emissiveMap).toBeNull();
    expect(sprite.material.emissiveIntensity).toBe(0);
  });

  it('advances multi-frame UV sprite-sheet clips and keeps depthMaterial synced', () => {
    const baseTex = new THREE.Texture();
    const spriteA = new PaperSprite({
      texture: baseTex,
      worldHeight: 2.0,
      columns: 4,
      rows: 2,
      animations: {
        idle: { row: 0, frames: 2, fps: 4, loop: true },
        wave: { row: 1, frames: 3, fps: 10, loop: false },
      },
      initialAnimation: 'idle',
    });
    const spriteB = new PaperSprite({
      texture: baseTex,
      worldHeight: 2.0,
      columns: 4,
      rows: 2,
      animations: {
        idle: { row: 0, frames: 2, fps: 4, loop: true },
      },
      initialAnimation: 'idle',
    });

    // Cloned sheet handles keep sprites independent while sharing depthMaterial sync
    expect(spriteA.texture).not.toBe(spriteB.texture);
    expect(spriteA.depthMaterial.map).toBe(spriteA.material.map);
    expect(spriteA.texture.repeat.x).toBeCloseTo(0.25, 5);
    expect(spriteA.texture.repeat.y).toBeCloseTo(0.5, 5);

    // Row 0 (top row) => v = 1 - 1/2 = 0.5, frame 0 => u = 0
    expect(spriteA.texture.offset.x).toBeCloseTo(0, 5);
    expect(spriteA.texture.offset.y).toBeCloseTo(0.5, 5);

    // Advance 0.25s at 4 fps => frame 1 => u = 0.25; spriteB stays at frame 0
    spriteA.update(0.25);
    expect(spriteA.getCurrentFrame()).toBe(1);
    expect(spriteA.texture.offset.x).toBeCloseTo(0.25, 5);
    expect(spriteB.texture.offset.x).toBeCloseTo(0, 5);

    // Looping wraps frame 1 -> 0
    spriteA.update(0.25);
    expect(spriteA.getCurrentFrame()).toBe(0);

    // Non-looping clip on row 1 clamps at final frame (index 2 => u = 0.5, v = 0)
    spriteA.playAnimation('wave');
    spriteA.update(0.5);
    expect(spriteA.getCurrentAnimation()).toBe('wave');
    expect(spriteA.getCurrentFrame()).toBe(2);
    expect(spriteA.texture.offset.x).toBeCloseTo(0.5, 5);
    expect(spriteA.texture.offset.y).toBeCloseTo(0, 5);
  });
});
