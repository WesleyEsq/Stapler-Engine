import { describe, expect, it } from 'vitest';
import { FixedCamera } from './FixedCamera';

describe('FixedCamera', () => {
  it('snaps to clamped bounds and applies offset cleanly', () => {
    const cam = new FixedCamera({
      fov: 38,
      offset: [0, 7, 10],
      lookAtOffset: [0, 1, 0],
      followPlayer: true,
      bounds: { minX: 3, maxX: 11, minZ: 2, maxZ: 8 },
    });

    cam.snapTo(20, -5);

    // Focus should clamp to (11, 0, 2) => camera at (11, 7, 12)
    expect(cam.camera.position.x).toBeCloseTo(11, 5);
    expect(cam.camera.position.y).toBeCloseTo(7, 5);
    expect(cam.camera.position.z).toBeCloseTo(12, 5);
  });

  it('converges deterministically toward the player when followPlayer is enabled', () => {
    const cam = new FixedCamera({
      fov: 38,
      offset: [0, 6, 8],
      lookAtOffset: [0, 0.8, 0],
      followPlayer: true,
      followSmoothing: 8,
      bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 20 },
    });

    cam.snapTo(2, 2);
    const initialX = cam.camera.position.x;

    // Step 1.25 seconds in fixed 0.05s increments
    for (let i = 0; i < 25; i += 1) {
      cam.update(0.05, 10, 6, 5, 5);
    }

    expect(cam.camera.position.x).toBeGreaterThan(initialX);
    expect(cam.camera.position.x).toBeCloseTo(10, 2);
    expect(cam.camera.position.z).toBeCloseTo(6 + 8, 2);
  });

  it('tracks fallback room center when followPlayer is disabled', () => {
    const cam = new FixedCamera({
      fov: 40,
      offset: [0, 5, 10],
      lookAtOffset: [0, 0, 0],
      followPlayer: false,
      followSmoothing: 10,
    });

    cam.snapTo(1, 1);

    for (let i = 0; i < 30; i += 1) {
      cam.update(0.05, 99, 99, 7, 5);
    }

    expect(cam.camera.position.x).toBeCloseTo(7, 2);
    expect(cam.camera.position.z).toBeCloseTo(5 + 10, 2);
  });

  it('toggles cameraLight visibility and syncs its position with the camera', () => {
    const cam = new FixedCamera({
      fov: 38,
      offset: [1, 6, 9],
      lookAtOffset: [0, 0.85, 0],
      followPlayer: true,
    });

    expect(cam.isCameraLightEnabled()).toBe(false);
    expect(cam.cameraLight.visible).toBe(false);

    cam.setCameraLightEnabled(true);
    cam.snapTo(4, 3);

    expect(cam.isCameraLightEnabled()).toBe(true);
    expect(cam.cameraLight.visible).toBe(true);
    expect(cam.cameraLight.position.x).toBeCloseTo(5, 5);
    expect(cam.cameraLight.position.y).toBeCloseTo(6, 5);
    expect(cam.cameraLight.position.z).toBeCloseTo(12, 5);
    expect(cam.cameraLightTarget.position.x).toBeCloseTo(4, 5);
    expect(cam.cameraLightTarget.position.y).toBeCloseTo(0.85, 5);
    expect(cam.cameraLightTarget.position.z).toBeCloseTo(3, 5);
  });
});
