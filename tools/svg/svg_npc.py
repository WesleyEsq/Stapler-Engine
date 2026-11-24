#!/usr/bin/env python3
"""Initialize a pre-rigged NPC SVG from tools/svg/templates/base_npc.svg with palette & height options."""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional

from svg_border import generate_cutout_border
from svg_common import register_svg_namespaces

TEMPLATE_PATH = Path(__file__).resolve().parent / "templates" / "base_npc.svg"


def _darken_hex(hex_color: str, factor: float = 0.85) -> str:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", hex_color):
        return hex_color
    r = max(0, min(255, int(round(int(hex_color[1:3], 16) * factor))))
    g = max(0, min(255, int(round(int(hex_color[3:5], 16) * factor))))
    b = max(0, min(255, int(round(int(hex_color[5:7], 16) * factor))))
    return f"#{r:02x}{g:02x}{b:02x}"


def init_npc_svg(
    out_path: Path,
    slots: Dict[str, str],
    height_scale: float = 1.0,
    width_scale: float = 1.0,
    padding: float = 3.2,
    floor_clip: float = 97.0,
) -> None:
    if not TEMPLATE_PATH.is_file():
        raise RuntimeError(f"Base NPC template missing at: {TEMPLATE_PATH}")

    register_svg_namespaces()
    tree = ET.parse(TEMPLATE_PATH)
    root = tree.getroot()

    # Auto-derive shaded companion slots if base slot was provided
    resolved_slots = dict(slots)
    if "coat" in resolved_slots and "coat_dark" not in resolved_slots:
        resolved_slots["coat_dark"] = _darken_hex(resolved_slots["coat"], 0.85)
    if "bottoms" in resolved_slots and "bottoms_dark" not in resolved_slots:
        resolved_slots["bottoms_dark"] = _darken_hex(resolved_slots["bottoms"], 0.86)
    if "hair" in resolved_slots and "hair_dark" not in resolved_slots:
        resolved_slots["hair_dark"] = _darken_hex(resolved_slots["hair"], 0.82)

    for elem in root.iter():
        slot = elem.attrib.get("data-slot")
        if slot and slot in resolved_slots:
            elem.attrib["fill"] = resolved_slots[slot]

    # Optional grounded proportion scaling anchored at foot baseline (x=50, y=95.8)
    if abs(height_scale - 1.0) > 1e-3 or abs(width_scale - 1.0) > 1e-3:
        for elem in root.iter():
            if elem.attrib.get("id") == "character_root":
                ax, ay = 50.0, 95.8
                elem.attrib["transform"] = (
                    f"translate({ax},{ay}) scale({width_scale:.3f},{height_scale:.3f}) translate({-ax},{-ay})"
                )
                break

    ET.indent(tree, space="  ")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_path, encoding="utf-8", xml_declaration=True)

    generate_cutout_border(
        svg_path=out_path,
        out_path=out_path,
        padding=padding,
        floor_clip=floor_clip,
        replace_backdrop=True,
    )


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create a new pre-rigged NPC SVG from base_npc.svg ready for hair/winter-outfit decoration."
    )
    parser.add_argument("out", type=Path, help="Destination .svg path for the new NPC.")
    parser.add_argument("--skin", type=str, default=None, help="Skin hex color (e.g. #e8c3a5, #c68c68, #f4e3d7).")
    parser.add_argument("--hair", type=str, default=None, help="Hair hex color (e.g. #3b2f2f, #c87137).")
    parser.add_argument("--coat", type=str, default=None, help="Winter coat/jacket hex color (e.g. #4b6b58, #7a4b3a).")
    parser.add_argument("--shirt", type=str, default=None, help="Inner sweater/shirt hex color (e.g. #d5dce3).")
    parser.add_argument("--bottoms", type=str, default=None, help="Trousers/skirt hex color (e.g. #3e4551).")
    parser.add_argument("--boots", type=str, default=None, help="Boots/shoes hex color (e.g. #2b2f36).")
    parser.add_argument("--height", type=float, default=1.0, help="Height scale factor anchored at y=95.8 (e.g. 0.94..1.05).")
    parser.add_argument("--width", type=float, default=1.0, help="Width scale factor anchored at x=50 (e.g. 0.95..1.08).")
    parser.add_argument("--padding", type=float, default=3.2, help="Cutout border padding in SVG units (default: 3.2).")
    args = parser.parse_args(argv)

    slots: Dict[str, str] = {}
    for key in ("skin", "hair", "coat", "shirt", "bottoms", "boots"):
        val = getattr(args, key)
        if val:
            slots[key] = val

    out_path = args.out.resolve()
    init_npc_svg(
        out_path=out_path,
        slots=slots,
        height_scale=args.height,
        width_scale=args.width,
        padding=args.padding,
    )
    print(f"Initialized pre-rigged NPC SVG: {out_path}")
    print("  Next: customize #hair_back, #hair_front, #torso, or #props (scarf/beanie/glasses), then run svg:border & svg:preview.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
