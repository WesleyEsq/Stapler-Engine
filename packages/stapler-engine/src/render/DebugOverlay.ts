import * as THREE from 'three';
import type { Vec2 } from '../types/contracts';
import type { NavGrid } from '../navigation/NavGrid';
import { getTargetPos, type InteractionSystem } from '../navigation/InteractionSystem';

export interface DebugOverlayOptions {
  navGrid: NavGrid;
  interactions?: InteractionSystem;
  patrolPaths?: Record<string, readonly Vec2[]>;
  visible?: boolean;
}

/**
 * Lightweight toggleable 3D overlay visualizing blocked `NavGrid` cells,
 * static 2D AABB colliders, `enter` zones, `interact` radii, NPC patrol
 * polylines, and the active A* click-to-move path.
 */
export class DebugOverlay {
  readonly group = new THREE.Group();
  private readonly pathLine: THREE.Line;

  constructor(options: DebugOverlayOptions) {
    this.group.name = 'stapler_debug_overlay';
    this.group.visible = options.visible ?? false;

    const { navGrid, interactions, patrolPaths } = options;

    // 1. Blocked NavGrid tiles (translucent red quads)
    const blockedMat = new THREE.MeshBasicMaterial({
      color: 0xff4455,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tileGeo = new THREE.PlaneGeometry(0.94, 0.94);
    tileGeo.rotateX(-Math.PI / 2);

    for (let row = 0; row < navGrid.height; row += 1) {
      for (let col = 0; col < navGrid.width; col += 1) {
        if (!navGrid.isTileBlocked(col, row)) continue;
        const quad = new THREE.Mesh(tileGeo, blockedMat);
        quad.position.set(col + 0.5, 0.015, row + 0.5);
        this.group.add(quad);
      }
    }

    // 2. Static 2D AABB colliders (amber outlines)
    const aabbMat = new THREE.LineBasicMaterial({ color: 0xffb347 });
    for (const box of navGrid.getStaticBoxes()) {
      const pts = [
        new THREE.Vector3(box.minX, 0.04, box.minZ),
        new THREE.Vector3(box.maxX, 0.04, box.minZ),
        new THREE.Vector3(box.maxX, 0.04, box.maxZ),
        new THREE.Vector3(box.minX, 0.04, box.maxZ),
        new THREE.Vector3(box.minX, 0.04, box.minZ),
      ];
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), aabbMat));
    }

    // 3. Walk-over enter zones (green rectangles) & interact radii (cyan rings)
    if (interactions) {
      const zoneMat = new THREE.LineBasicMaterial({ color: 0x4ee88a });
      for (const zone of interactions.getZones()) {
        const b = zone.bounds;
        const pts = [
          new THREE.Vector3(b.minX, 0.05, b.minZ),
          new THREE.Vector3(b.maxX, 0.05, b.minZ),
          new THREE.Vector3(b.maxX, 0.05, b.maxZ),
          new THREE.Vector3(b.minX, 0.05, b.maxZ),
          new THREE.Vector3(b.minX, 0.05, b.minZ),
        ];
        this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), zoneMat));
      }

      const ringMat = new THREE.LineBasicMaterial({ color: 0x4fd2ff });
      for (const target of interactions.getInteractables()) {
        const pos = getTargetPos(target);
        const pts: THREE.Vector3[] = [];
        const segs = 28;
        for (let i = 0; i <= segs; i += 1) {
          const a = (i / segs) * Math.PI * 2;
          pts.push(
            new THREE.Vector3(
              pos.x + Math.cos(a) * target.interactionRadius,
              0.045,
              pos.z + Math.sin(a) * target.interactionRadius,
            ),
          );
        }
        this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
      }
    }

    // 4. Patrol paths (violet polylines)
    if (patrolPaths) {
      const patrolMat = new THREE.LineBasicMaterial({ color: 0xc084fc });
      for (const points of Object.values(patrolPaths)) {
        if (points.length < 2) continue;
        const pts = points.map((p) => new THREE.Vector3(p.x, 0.06, p.z));
        this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), patrolMat));
      }
    }

    // 5. Dynamic active A* path line (bright orange)
    const pathGeo = new THREE.BufferGeometry();
    const pathMat = new THREE.LineBasicMaterial({ color: 0xff6b4a });
    this.pathLine = new THREE.Line(pathGeo, pathMat);
    this.pathLine.frustumCulled = false;
    this.group.add(this.pathLine);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  isVisible(): boolean {
    return this.group.visible;
  }

  setActivePath(waypoints: readonly Vec2[]): void {
    const pts = waypoints.map((p) => new THREE.Vector3(p.x, 0.07, p.z));
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
}
