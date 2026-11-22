import * as THREE from 'three';
import type { AssetScope } from '../types/contracts';

interface DisposableResource {
  dispose(): void;
}

/**
 * Tracks GPU/runtime resources under either `persistent` or `scene` scope
 * so leaving an environment deterministically frees WebGL VRAM.
 */
export class AssetManager {
  private readonly scopedResources: Record<AssetScope, Set<DisposableResource>> = {
    persistent: new Set(),
    scene: new Set(),
  };

  private readonly textures = new Map<string, { texture: THREE.Texture; scope: AssetScope }>();

  register(resource: DisposableResource, scope: AssetScope = 'scene'): void {
    this.scopedResources[scope].add(resource);
  }

  registerObject3D(root: THREE.Object3D, scope: AssetScope = 'scene'): void {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (node.geometry) {
          this.register(node.geometry, scope);
        }
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (mat) {
            this.registerMaterial(mat, scope);
          }
        }
        if (node.customDepthMaterial) {
          this.register(node.customDepthMaterial, scope);
        }
      }
    });
  }

  private registerMaterial(mat: THREE.Material, scope: AssetScope): void {
    this.register(mat, scope);
    for (const value of Object.values(mat)) {
      if (value instanceof THREE.Texture) {
        const tracked = this.findTextureEntry(value);
        if (!tracked || tracked.scope === scope) {
          this.register(value, scope);
        }
      }
    }
  }

  private findTextureEntry(texture: THREE.Texture): { texture: THREE.Texture; scope: AssetScope } | undefined {
    for (const entry of this.textures.values()) {
      if (entry.texture === texture) return entry;
    }
    return undefined;
  }

  cacheTexture(key: string, texture: THREE.Texture, scope: AssetScope = 'scene'): void {
    this.textures.set(key, { texture, scope });
    this.register(texture, scope);
  }

  getTexture(key: string): THREE.Texture | undefined {
    return this.textures.get(key)?.texture;
  }

  disposeScope(scope: AssetScope): number {
    let disposedCount = 0;
    for (const resource of this.scopedResources[scope]) {
      resource.dispose();
      disposedCount += 1;
    }
    this.scopedResources[scope].clear();

    for (const [key, entry] of this.textures.entries()) {
      if (entry.scope === scope) {
        this.textures.delete(key);
      }
    }
    return disposedCount;
  }

  disposeAll(): void {
    this.disposeScope('scene');
    this.disposeScope('persistent');
  }
}
