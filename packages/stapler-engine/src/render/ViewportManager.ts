import * as THREE from 'three';

export interface ViewportOptions {
  container: HTMLElement;
  maxDpr?: number;
  baseWidth?: number;
  baseHeight?: number;
}

/**
 * Manages responsive sizing of the WebGL canvas, camera aspect ratio,
 * and a normalized CSS `--ui-scale` custom property for the HTML overlay.
 */
export class ViewportManager {
  readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly maxDpr: number;
  private readonly baseWidth: number;
  private readonly baseHeight: number;
  private readonly observer: ResizeObserver;
  private camera: THREE.PerspectiveCamera | null = null;

  constructor(options: ViewportOptions) {
    this.container = options.container;
    this.maxDpr = options.maxDpr ?? 2;
    this.baseWidth = options.baseWidth ?? 1280;
    this.baseHeight = options.baseHeight ?? 720;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);
    this.resize();
  }

  attachCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.resize();
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    const uiScale = Math.min(width / this.baseWidth, height / this.baseHeight);
    this.container.style.setProperty('--ui-scale', uiScale.toFixed(4));
  }

  getSize(): { width: number; height: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    };
  }

  dispose(): void {
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
