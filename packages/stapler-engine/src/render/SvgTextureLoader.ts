import * as THREE from 'three';
import type { AssetManager } from '../core/AssetManager';
import type { AssetScope } from '../types/contracts';

export interface SvgRasterizeOptions {
  width: number;
  height: number;
  scope?: AssetScope;
  cacheKey?: string;
}

/**
 * Fetches an SVG file and rasterizes it cleanly onto an offscreen canvas
 * at high DPI so Three.js can render it with PBR lighting and alphaTest shadows.
 */
export class SvgTextureLoader {
  constructor(private readonly assets: AssetManager) {}

  async load(url: string, options: SvgRasterizeOptions): Promise<THREE.CanvasTexture> {
    const key = options.cacheKey ?? `svg:${url}:${options.width}x${options.height}`;
    const cached = this.assets.getTexture(key);
    if (cached instanceof THREE.CanvasTexture) {
      return cached;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch SVG "${url}" (${response.status})`);
    }
    const svgText = await response.text();
    const img = await this.decodeSvgImage(svgText, options.width, options.height);

    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D canvas context for SVG rasterization');
    }

    ctx.clearRect(0, 0, options.width, options.height);
    // Preserve aspect ratio centered within the target canvas, anchored at bottom
    const scale = Math.min(options.width / img.width, options.height / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = (options.width - drawW) * 0.5;
    const drawY = options.height - drawH;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    this.assets.cacheTexture(key, texture, options.scope ?? 'scene');
    return texture;
  }

  private decodeSvgImage(svgText: string, fallbackW: number, fallbackH: number): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        if (img.width === 0 || img.height === 0) {
          img.width = fallbackW;
          img.height = fallbackH;
        }
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`Failed to decode SVG image: ${String(err)}`));
      };
      img.src = blobUrl;
    });
  }
}
