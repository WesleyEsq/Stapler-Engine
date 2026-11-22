import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LightingRig } from './LightingRig';
import type { LightConfig } from '../types/contracts';

describe('LightingRig', () => {
  it('enforces maxLights and maxShadowLights caps with warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rig = new LightingRig({ maxLights: 4, maxShadowLights: 2 });

    const configs: LightConfig[] = [
      { type: 'directional', color: '#ffffff', intensity: 1.5, castShadow: true },
      { type: 'spot', color: '#ffeecc', intensity: 2.0, castShadow: true },
      { type: 'point', color: '#ff9944', intensity: 3.0, castShadow: true },
      { type: 'hemisphere', color: '#ffffff', groundColor: '#444444', intensity: 0.6 },
      { type: 'point', color: '#88ccff', intensity: 1.0 },
    ];

    rig.configure(configs);

    const lights = rig.group.children.filter((c): c is THREE.Light => c instanceof THREE.Light);
    // 1 flatAmbient + 4 capped dynamic lights
    expect(lights).toHaveLength(5);

    const shadowCasters = lights.filter((l) => l.castShadow);
    expect(shadowCasters).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it('skips attachToCamera lights managed by FixedCamera', () => {
    const rig = new LightingRig();
    rig.configure([
      { type: 'spot', color: '#ffffff', intensity: 5, attachToCamera: true },
      { type: 'hemisphere', color: '#ffffff', intensity: 1 },
    ]);

    const lights = rig.group.children.filter((c): c is THREE.Light => c instanceof THREE.Light);
    // flatAmbient + hemisphere only
    expect(lights).toHaveLength(2);
  });

  it('toggles cleanly between dynamic and flat ambient lighting', () => {
    const rig = new LightingRig();
    rig.configure([
      { type: 'directional', color: '#ffffff', intensity: 1.5, castShadow: true },
      { type: 'point', color: '#ffaa55', intensity: 4.0 },
    ]);

    const ambient = rig.group.children.find((c): c is THREE.AmbientLight => c instanceof THREE.AmbientLight);
    const dynamic = rig.group.children.filter(
      (c): c is THREE.Light => c instanceof THREE.Light && !(c instanceof THREE.AmbientLight),
    );

    expect(ambient).toBeDefined();
    expect(ambient?.visible).toBe(false);
    expect(dynamic.every((l) => l.visible)).toBe(true);

    rig.setDynamicLighting(false);
    expect(rig.isDynamicLightingEnabled()).toBe(false);
    expect(ambient?.visible).toBe(true);
    expect(dynamic.every((l) => !l.visible)).toBe(true);

    rig.setDynamicLighting(true);
    expect(rig.isDynamicLightingEnabled()).toBe(true);
    expect(ambient?.visible).toBe(false);
    expect(dynamic.every((l) => l.visible)).toBe(true);
  });

  it('removes dynamic lights, removes targets, and disposes shadow maps on clear()', () => {
    const rig = new LightingRig();
    rig.configure([
      { type: 'directional', color: '#ffffff', intensity: 1.5, castShadow: true },
    ]);

    const dirLight = rig.group.children.find(
      (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
    );
    expect(dirLight).toBeDefined();

    // Simulate an allocated WebGLRenderTarget shadow map
    const fakeShadowMap = { dispose: vi.fn() };
    (dirLight!.shadow as unknown as { map: { dispose: () => void } }).map = fakeShadowMap;

    rig.clear();

    expect(fakeShadowMap.dispose).toHaveBeenCalledTimes(1);
    // Only the persistent flatAmbient light should remain in the group
    expect(rig.group.children).toHaveLength(1);
    expect(rig.group.children[0]).toBeInstanceOf(THREE.AmbientLight);
  });
});
