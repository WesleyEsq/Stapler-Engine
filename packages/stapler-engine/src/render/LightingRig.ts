import * as THREE from 'three';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type LightConfig } from '../types/contracts';

/**
 * Manages environment lighting with a configurable soft light budget
 * and a strict guardrail on shadow-casting lights (max 2 by default),
 * plus a live toggle between dynamic 3D lighting and flat uniform lighting.
 */
export class LightingRig {
  readonly group = new THREE.Group();
  private readonly dynamicLights: THREE.Light[] = [];
  private readonly flatAmbient: THREE.AmbientLight;
  private readonly config: EngineConfig;
  private dynamicEnabled = true;

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.flatAmbient = new THREE.AmbientLight(0xffffff, 2.2);
    this.flatAmbient.visible = false;
    this.group.add(this.flatAmbient);
  }

  configure(lights: LightConfig[], shadowAreaRadius = 14): void {
    this.clear();

    let shadowCount = 0;
    const cappedLights = lights.slice(0, this.config.maxLights);
    if (lights.length > this.config.maxLights) {
      console.warn(
        `[LightingRig] Environment requested ${lights.length} lights; capped at ${this.config.maxLights}.`,
      );
    }

    for (const def of cappedLights) {
      if (def.attachToCamera) {
        // Camera-mounted lights are managed by FixedCamera
        continue;
      }

      const allowShadow = Boolean(def.castShadow) && shadowCount < this.config.maxShadowLights;
      if (def.castShadow && !allowShadow) {
        console.warn(
          `[LightingRig] Shadow caster limit (${this.config.maxShadowLights}) reached; disabling shadows on extra light.`,
        );
      }

      const light = this.createLight(def, allowShadow, shadowAreaRadius);
      if (allowShadow) {
        shadowCount += 1;
      }

      this.dynamicLights.push(light);
      this.group.add(light);
      if ('target' in light && light.target instanceof THREE.Object3D) {
        this.group.add(light.target);
      }
    }

    this.applyMode();
  }

  private createLight(def: LightConfig, castShadow: boolean, shadowRadius: number): THREE.Light {
    const color = new THREE.Color(def.color);

    switch (def.type) {
      case 'hemisphere': {
        const ground = new THREE.Color(def.groundColor ?? '#4a4654');
        return new THREE.HemisphereLight(color, ground, def.intensity);
      }
      case 'directional': {
        const light = new THREE.DirectionalLight(color, def.intensity);
        const [x, y, z] = def.position ?? [8, 12, 8];
        light.position.set(x, y, z);
        if (def.target) {
          light.target.position.set(def.target[0], def.target[1], def.target[2]);
        }
        if (castShadow) {
          light.castShadow = true;
          light.shadow.mapSize.set(2048, 2048);
          light.shadow.camera.near = 1;
          light.shadow.camera.far = 45;
          light.shadow.camera.left = -shadowRadius;
          light.shadow.camera.right = shadowRadius;
          light.shadow.camera.top = shadowRadius;
          light.shadow.camera.bottom = -shadowRadius;
          light.shadow.bias = -0.0005;
          light.shadow.normalBias = 0.02;
        }
        return light;
      }
      case 'spot': {
        const light = new THREE.SpotLight(
          color,
          def.intensity,
          def.distance ?? 25,
          def.angle ?? Math.PI / 4,
          def.penumbra ?? 0.45,
          def.decay ?? 1.5,
        );
        const [x, y, z] = def.position ?? [0, 8, 4];
        light.position.set(x, y, z);
        if (def.target) {
          light.target.position.set(def.target[0], def.target[1], def.target[2]);
        }
        if (castShadow) {
          light.castShadow = true;
          light.shadow.mapSize.set(1024, 1024);
          light.shadow.bias = -0.0005;
          light.shadow.normalBias = 0.02;
        }
        return light;
      }
      case 'point':
      default: {
        const light = new THREE.PointLight(
          color,
          def.intensity,
          def.distance ?? 18,
          def.decay ?? 1.5,
        );
        const [x, y, z] = def.position ?? [0, 3, 0];
        light.position.set(x, y, z);
        if (castShadow) {
          light.castShadow = true;
          light.shadow.mapSize.set(512, 512);
          light.shadow.bias = -0.001;
        }
        return light;
      }
    }
  }

  setDynamicLighting(enabled: boolean): void {
    this.dynamicEnabled = enabled;
    this.applyMode();
  }

  isDynamicLightingEnabled(): boolean {
    return this.dynamicEnabled;
  }

  private applyMode(): void {
    for (const light of this.dynamicLights) {
      light.visible = this.dynamicEnabled;
    }
    this.flatAmbient.visible = !this.dynamicEnabled;
  }

  clear(): void {
    for (const light of this.dynamicLights) {
      if ('target' in light && light.target instanceof THREE.Object3D) {
        this.group.remove(light.target);
      }
      if ('shadow' in light && light.shadow?.map) {
        light.shadow.map.dispose();
      }
      this.group.remove(light);
    }
    this.dynamicLights.length = 0;
  }
}
