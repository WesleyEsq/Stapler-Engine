import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Aabb2D, AssetScope } from '../types/contracts';
import type { AssetManager } from '../core/AssetManager';

export interface PropSpawnOptions {
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  scope?: AssetScope;
  id?: string;
}

export interface SpawnedProp {
  root: THREE.Group;
  footprint: Aabb2D;
}

/**
 * Loads `.glb` binary glTF environment props, caches base prototypes per URL,
 * instantiates clones with shadow flags, and computes world-space 2D footprints
 * for optional registration in `NavGrid`.
 */
export class PropLoader {
  private readonly loader = new GLTFLoader();
  private readonly prototypes = new Map<string, { root: THREE.Group; scope: AssetScope }>();
  private readonly assets?: AssetManager;

  constructor(assets?: AssetManager) {
    this.assets = assets;
  }

  async loadPrototype(url: string, scope: AssetScope = 'scene'): Promise<THREE.Group> {
    const cached = this.prototypes.get(url);
    if (cached) {
      return cached.root;
    }

    const gltf = await this.loader.loadAsync(url);
    const root = gltf.scene;
    this.prototypes.set(url, { root, scope });
    this.assets?.registerObject3D(root, scope);
    return root;
  }

  async spawn(url: string, options: PropSpawnOptions = {}): Promise<SpawnedProp> {
    const scope = options.scope ?? 'scene';
    const proto = await this.loadPrototype(url, scope);
    const instance = proto.clone(true);

    const [x, y, z] = options.position ?? [0, 0, 0];
    instance.position.set(x, y, z);
    instance.rotation.y = options.rotationY ?? 0;
    const s = options.scale ?? 1;
    instance.scale.set(s, s, s);

    const castShadow = options.castShadow ?? true;
    const receiveShadow = options.receiveShadow ?? true;
    instance.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = castShadow;
        node.receiveShadow = receiveShadow;
      }
    });

    instance.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(instance);
    const footprint: Aabb2D = {
      id: options.id,
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
    };

    return { root: instance, footprint };
  }

  /** Clears cached prototype references for a disposed scope so scene reloads refetch cleanly. */
  clearScope(scope: AssetScope): void {
    for (const [url, entry] of this.prototypes.entries()) {
      if (entry.scope === scope) {
        this.prototypes.delete(url);
      }
    }
  }
}
