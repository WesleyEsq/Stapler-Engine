import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from './AssetManager';

describe('AssetManager', () => {
  it('disposes scene-scoped resources without touching persistent resources', () => {
    const assets = new AssetManager();
    const sceneRes = { dispose: vi.fn() };
    const persistentRes = { dispose: vi.fn() };

    assets.register(sceneRes, 'scene');
    assets.register(persistentRes, 'persistent');

    const count = assets.disposeScope('scene');

    expect(count).toBe(1);
    expect(sceneRes.dispose).toHaveBeenCalledTimes(1);
    expect(persistentRes.dispose).not.toHaveBeenCalled();
  });

  it('disposes scene meshes, materials, and customDepthMaterial while preserving shared persistent textures', () => {
    const assets = new AssetManager();

    const persistentTex = new THREE.Texture();
    const persistentTexDispose = vi.spyOn(persistentTex, 'dispose');
    assets.cacheTexture('hero_tex', persistentTex, 'persistent');

    const sceneTex = new THREE.Texture();
    const sceneTexDispose = vi.spyOn(sceneTex, 'dispose');
    assets.cacheTexture('room_floor', sceneTex, 'scene');

    const group = new THREE.Group();

    const heroGeo = new THREE.PlaneGeometry(1, 1);
    const heroGeoDispose = vi.spyOn(heroGeo, 'dispose');
    const heroMat = new THREE.MeshStandardMaterial({ map: persistentTex });
    const heroMatDispose = vi.spyOn(heroMat, 'dispose');
    const depthMat = new THREE.MeshDepthMaterial({ map: persistentTex });
    const depthMatDispose = vi.spyOn(depthMat, 'dispose');
    const heroMesh = new THREE.Mesh(heroGeo, heroMat);
    heroMesh.customDepthMaterial = depthMat;

    const floorGeo = new THREE.PlaneGeometry(4, 4);
    const floorGeoDispose = vi.spyOn(floorGeo, 'dispose');
    const floorMat = new THREE.MeshStandardMaterial({ map: sceneTex });
    const floorMatDispose = vi.spyOn(floorMat, 'dispose');
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);

    group.add(heroMesh, floorMesh);
    assets.registerObject3D(group, 'scene');

    assets.disposeScope('scene');

    expect(heroGeoDispose).toHaveBeenCalledTimes(1);
    expect(heroMatDispose).toHaveBeenCalledTimes(1);
    expect(depthMatDispose).toHaveBeenCalledTimes(1);
    expect(floorGeoDispose).toHaveBeenCalledTimes(1);
    expect(floorMatDispose).toHaveBeenCalledTimes(1);
    expect(sceneTexDispose).toHaveBeenCalledTimes(1);
    expect(assets.getTexture('room_floor')).toBeUndefined();

    // Persistent texture must remain alive and cached even though a scene material used it
    expect(persistentTexDispose).not.toHaveBeenCalled();
    expect(assets.getTexture('hero_tex')).toBe(persistentTex);
  });

  it('disposes all scopes and clears all cached textures on disposeAll()', () => {
    const assets = new AssetManager();
    const texA = new THREE.Texture();
    const texB = new THREE.Texture();
    const spyA = vi.spyOn(texA, 'dispose');
    const spyB = vi.spyOn(texB, 'dispose');

    assets.cacheTexture('a', texA, 'scene');
    assets.cacheTexture('b', texB, 'persistent');

    assets.disposeAll();

    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledTimes(1);
    expect(assets.getTexture('a')).toBeUndefined();
    expect(assets.getTexture('b')).toBeUndefined();
  });
});
