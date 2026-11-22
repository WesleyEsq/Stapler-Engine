import * as THREE from 'three';
import type { CameraConfig } from '../types/contracts';

/**
 * Fixed-angle 2.5D camera with optional smooth player tracking
 * (clamped to room bounds) and an optional camera-mounted light.
 */
export class FixedCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraLight: THREE.SpotLight;
  readonly cameraLightTarget = new THREE.Object3D();

  private config: CameraConfig;
  private readonly focusPoint = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly lookAtOffset = new THREE.Vector3();
  private cameraLightEnabled = false;

  constructor(config: CameraConfig) {
    this.config = { ...config };
    this.camera = new THREE.PerspectiveCamera(config.fov, 16 / 9, 0.1, 120);

    this.cameraLight = new THREE.SpotLight(0xfff4df, 18, 28, Math.PI / 5, 0.65, 1.4);
    this.cameraLight.castShadow = false;
    this.cameraLight.visible = false;
    this.cameraLight.target = this.cameraLightTarget;

    this.applyConfig(config);
  }

  attachToScene(scene: THREE.Scene): void {
    scene.add(this.cameraLight);
    scene.add(this.cameraLightTarget);
  }

  applyConfig(config: CameraConfig): void {
    this.config = { ...config };
    this.camera.fov = config.fov;
    this.camera.updateProjectionMatrix();
    this.offset.set(config.offset[0], config.offset[1], config.offset[2]);
    this.lookAtOffset.set(config.lookAtOffset[0], config.lookAtOffset[1], config.lookAtOffset[2]);
  }

  setFollowPlayer(follow: boolean): void {
    this.config.followPlayer = follow;
  }

  isFollowingPlayer(): boolean {
    return this.config.followPlayer;
  }

  setCameraLightEnabled(enabled: boolean): void {
    this.cameraLightEnabled = enabled;
    this.cameraLight.visible = enabled;
  }

  isCameraLightEnabled(): boolean {
    return this.cameraLightEnabled;
  }

  snapTo(x: number, z: number): void {
    this.setDesiredFocus(x, z);
    this.focusPoint.copy(this.desiredFocus);
    this.syncTransform();
  }

  update(dt: number, targetX: number, targetZ: number, fallbackCenterX: number, fallbackCenterZ: number): void {
    if (this.config.followPlayer) {
      this.setDesiredFocus(targetX, targetZ);
    } else {
      this.setDesiredFocus(fallbackCenterX, fallbackCenterZ);
    }

    const smoothing = this.config.followSmoothing ?? 6.5;
    const alpha = 1 - Math.exp(-smoothing * dt);
    this.focusPoint.lerp(this.desiredFocus, alpha);
    this.syncTransform();
  }

  private setDesiredFocus(x: number, z: number): void {
    let clampedX = x;
    let clampedZ = z;
    if (this.config.bounds) {
      clampedX = Math.max(this.config.bounds.minX, Math.min(this.config.bounds.maxX, clampedX));
      clampedZ = Math.max(this.config.bounds.minZ, Math.min(this.config.bounds.maxZ, clampedZ));
    }
    this.desiredFocus.set(clampedX, 0, clampedZ);
  }

  private syncTransform(): void {
    this.camera.position.copy(this.focusPoint).add(this.offset);
    const lookTarget = this.focusPoint.clone().add(this.lookAtOffset);
    this.camera.lookAt(lookTarget);

    this.cameraLight.position.copy(this.camera.position);
    this.cameraLightTarget.position.copy(lookTarget);
    this.cameraLightTarget.updateMatrixWorld();
  }
}
