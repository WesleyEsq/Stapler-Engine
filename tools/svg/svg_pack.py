#!/usr/bin/env python3
"""Pack individual character/prop SVG frames into a Stapler Engine multi-frame SVG spritesheet."""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from svg_common import (
    INKSCAPE_NS,
    SVG_NS,
    XLINK_NS,
    local_tag,
    parse_viewbox,
    register_svg_namespaces,
)

SKIP_ROOT_TAGS = {"namedview", "metadata", "title", "desc"}
URL_REF_RE = re.compile(r"url\(#([^)]+)\)")


def _scope_element_ids(elem: ET.Element, prefix: str) -> None:
    """Prefix every id and internal #reference within an element subtree to avoid DOM collisions."""
    for node in elem.iter():
        if "id" in node.attrib:
            node.attrib["id"] = f"{prefix}_{node.attrib['id']}"

        for attr_key, val in list(node.attrib.items()):
            if not val:
                continue
            if attr_key in ("href", f"{{{XLINK_NS}}}href") and val.startswith("#"):
                node.attrib[attr_key] = f"#{prefix}_{val[1:]}"
            elif attr_key == f"{{{INKSCAPE_NS}}}path-effect" and val.startswith("#"):
                node.attrib[attr_key] = f"#{prefix}_{val[1:]}"
            elif "url(#" in val:
                node.attrib[attr_key] = URL_REF_RE.sub(lambda m: f"url(#{prefix}_{m.group(1)})", val)


def pack_spritesheet(
    cells: List[Tuple[int, int, Path]],
    cols: int,
    rows: int,
    out_path: Path,
    cell_size: float = 100.0,
) -> None:
    register_svg_namespaces()
    total_w = cols * cell_size
    total_h = rows * cell_size

    sheet_root = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "version": "1.1",
            "width": f"{total_w:g}mm",
            "height": f"{total_h:g}mm",
            "viewBox": f"0 0 {total_w:g} {total_h:g}",
        },
    )
    defs_elem = ET.SubElement(sheet_root, f"{{{SVG_NS}}}defs")
    has_defs = False

    for idx, (col, row, frame_path) in enumerate(cells):
        if not frame_path.is_file():
            raise RuntimeError(f"Frame SVG not found: {frame_path}")
        frame_root = ET.parse(frame_path).getroot()
        vb = parse_viewbox(frame_root)
        if vb is None:
            raise RuntimeError(f"Frame SVG '{frame_path}' is missing a valid viewBox.")

        fx, fy, fw, fh = vb
        prefix = f"f{idx}"

        # Bottom-anchored, horizontally centered fit inside the cell (matching SvgTextureLoader)
        scale = min(cell_size / fw, cell_size / fh)
        draw_w = fw * scale
        draw_h = fh * scale
        tx = col * cell_size + (cell_size - draw_w) * 0.5 - fx * scale
        ty = row * cell_size + (cell_size - draw_h) - fy * scale

        if abs(scale - 1.0) < 1e-4:
            transform = f"translate({tx:.3f},{ty:.3f})"
        else:
            transform = f"translate({tx:.3f},{ty:.3f}) scale({scale:.5f})"

        cell_g = ET.SubElement(
            sheet_root,
            f"{{{SVG_NS}}}g",
            {
                "id": f"cell_r{row}_c{col}",
                "transform": transform,
            },
        )

        for child in list(frame_root):
            tag = local_tag(child)
            if tag in SKIP_ROOT_TAGS:
                continue
            cloned = copy.deepcopy(child)
            _scope_element_ids(cloned, prefix)
            if tag == "defs":
                for def_child in list(cloned):
                    defs_elem.append(def_child)
                    has_defs = True
            else:
                cell_g.append(cloned)

    if not has_defs:
        sheet_root.remove(defs_elem)

    tree = ET.ElementTree(sheet_root)
    ET.indent(tree, space="  ")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_path, encoding="utf-8", xml_declaration=True)


def _print_manifest_snippet(
    sprite_id: str,
    out_path: Path,
    cols: int,
    rows: int,
    world_height: float,
    animations: Dict[str, dict],
) -> None:
    cell_px = min(512, 2048 // max(cols, rows))
    render_w = cell_px * cols
    render_h = cell_px * rows

    # Derive public URL if inside games/*/public/
    url = f"/assets/sprites/{out_path.name}"
    parts = out_path.parts
    if "public" in parts:
        pub_idx = parts.index("public")
        url = "/" + "/".join(parts[pub_idx + 1 :])

    print("\nReady-to-paste SpriteAnimationSpec snippet (manifest.ts):")
    print(f"  {sprite_id}: {{")
    print(f"    id: '{sprite_id}',")
    print(f"    svgUrl: '{url}',")
    print(f"    renderWidth: {render_w},")
    print(f"    renderHeight: {render_h},")
    print(f"    worldHeight: {world_height},")
    print(f"    columns: {cols},")
    print(f"    rows: {rows},")
    if animations:
        print("    animations: {")
        for clip_name, clip in animations.items():
            loop_str = "true" if clip.get("loop", True) else "false"
            print(
                f"      {clip_name}: {{ row: {clip['row']}, frames: {clip['frames']}, "
                f"fps: {clip.get('fps', 6)}, loop: {loop_str} }},"
            )
        print("    },")
    print("  },")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Pack individual SVG frames into a Stapler Engine UV spritesheet SVG."
    )
    parser.add_argument("frames", nargs="*", type=Path, help="Ordered frame SVG paths (row-major).")
    parser.add_argument("--config", type=Path, default=None, help="JSON config defining rows, animations, and frame paths.")
    parser.add_argument("--cols", type=int, default=None, help="Number of columns in the spritesheet.")
    parser.add_argument("--rows", type=int, default=None, help="Number of rows in the spritesheet.")
    parser.add_argument("--out", type=Path, default=None, help="Output spritesheet .svg path.")
    parser.add_argument("--id", dest="sprite_id", type=str, default=None, help="Sprite ID for manifest snippet.")
    parser.add_argument("--cell-size", type=float, default=100.0, help="Cell size in SVG units (default: 100).")
    parser.add_argument("--world-height", type=float, default=2.0, help="World height in tiles for manifest snippet (default: 2.0).")
    args = parser.parse_args(argv)

    cells: List[Tuple[int, int, Path]] = []
    animations: Dict[str, dict] = {}
    cell_size = args.cell_size
    world_height = args.world_height
    sprite_id = args.sprite_id

    if args.config is not None:
        cfg_path = args.config.resolve()
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        base_dir = cfg_path.parent
        cols = int(args.cols or cfg["columns"])
        rows = int(args.rows or cfg["rows"])
        cell_size = float(cfg.get("cellSize", cell_size))
        world_height = float(cfg.get("worldHeight", world_height))
        sprite_id = sprite_id or str(cfg.get("id", cfg_path.stem))
        out_path = (args.out or (base_dir / cfg["out"])).resolve()

        for clip_name, clip_cfg in cfg.get("animations", {}).items():
            row_idx = int(clip_cfg["row"])
            frame_list = clip_cfg["frames"]
            for col_idx, rel_frame in enumerate(frame_list):
                if col_idx >= cols or row_idx >= rows:
                    raise RuntimeError(
                        f"Clip '{clip_name}' frame {col_idx} at row {row_idx} exceeds {cols}x{rows} sheet."
                    )
                cells.append((col_idx, row_idx, (base_dir / rel_frame).resolve()))
            animations[clip_name] = {
                "row": row_idx,
                "frames": len(frame_list),
                "fps": clip_cfg.get("fps", 6),
                "loop": clip_cfg.get("loop", True),
            }
    else:
        if not args.frames:
            parser.error("Provide frame SVG paths or --config <pack.json>.")
        if args.out is None:
            parser.error("--out <sheet.svg> is required when not using --config.")
        cols = args.cols or len(args.frames)
        rows = args.rows or ((len(args.frames) + cols - 1) // cols)
        if len(args.frames) > cols * rows:
            parser.error(f"Got {len(args.frames)} frames, which exceeds {cols}x{rows} = {cols * rows} cells.")
        out_path = args.out.resolve()
        sprite_id = sprite_id or out_path.stem
        for idx, frame in enumerate(args.frames):
            cells.append((idx % cols, idx // cols, frame.resolve()))
        for r in range(rows):
            row_count = sum(1 for _, rr, _ in cells if rr == r)
            if row_count > 0:
                animations[f"row_{r}"] = {"row": r, "frames": row_count, "fps": 6, "loop": True}

    pack_spritesheet(cells=cells, cols=cols, rows=rows, out_path=out_path, cell_size=cell_size)
    print(f"Packed {len(cells)} frames into {cols}x{rows} spritesheet: {out_path}")
    _print_manifest_snippet(sprite_id, out_path, cols, rows, world_height, animations)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
