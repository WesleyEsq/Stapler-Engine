#!/usr/bin/env python3
"""Generate simple puppet animation frames or pose variants from a rigged Stapler Engine SVG."""

from __future__ import annotations

import argparse
import copy
import json
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from svg_border import generate_cutout_border
from svg_common import DEFAULT_PREVIEW_DIR, parse_viewbox, query_svg_bboxes, register_svg_namespaces
from svg_pack import _print_manifest_snippet, pack_spritesheet

# Coupled head children: if a preset/frame transforms "head_unit", move all present head parts together
HEAD_UNIT_GROUPS = ("hair_back", "head", "face", "hair_front", "props")


def _find_group_aliases(by_id: Dict[str, ET.Element], canonical: str) -> Optional[str]:
    """Resolve left/right vs front/back arm naming transparently across rigged characters & base_npc."""
    if canonical in by_id:
        return canonical
    fallbacks = {
        "arm_left": ("arm_front",),
        "arm_right": ("arm_back",),
        "arm_front": ("arm_left",),
        "arm_back": ("arm_right",),
    }
    for alt in fallbacks.get(canonical, ()):
        if alt in by_id:
            return alt
    return None


def _resolve_pivot(
    pivot_spec: object,
    bbox: Optional[Tuple[float, float, float, float]],
) -> Tuple[float, float]:
    if isinstance(pivot_spec, (list, tuple)) and len(pivot_spec) == 2:
        return float(pivot_spec[0]), float(pivot_spec[1])

    if bbox is None:
        return 50.0, 50.0

    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) * 0.5
    cy = (y0 + y1) * 0.5
    h = y1 - y0
    mode = str(pivot_spec or "top").lower()
    if mode == "top":
        return cx, y0 + 0.10 * h
    if mode == "bottom":
        return cx, y1 - 0.08 * h
    if mode == "center":
        return cx, cy
    raise ValueError(f"Unknown pivot spec '{pivot_spec}'. Use 'top', 'bottom', 'center', or [x, y].")


def build_preset_spec(preset: str, amplitude: float = 1.0) -> dict:
    """Return a clean, conservative puppet keyframe spec scaled by `amplitude`."""
    a = amplitude
    name = preset.lower()
    if name == "idle":
        return {
            "fps": 3,
            "loop": True,
            "frames": [
                {"name": "idle_0", "transforms": {}},
                {
                    "name": "idle_1",
                    "transforms": {
                        "torso": {"translate": [0.0, 0.55 * a]},
                        "head_unit": {"translate": [0.0, 0.75 * a], "rotate": 0.8 * a, "pivot": "bottom"},
                        "arm_left": {"translate": [0.0, 0.55 * a], "rotate": 1.6 * a, "pivot": "top"},
                        "arm_right": {"translate": [0.0, 0.55 * a], "rotate": -1.6 * a, "pivot": "top"},
                    },
                },
            ],
        }

    if name == "walk":
        return {
            "fps": 6,
            "loop": True,
            "frames": [
                {
                    "name": "walk_0_contact_l",
                    "transforms": {
                        "leg_left": {"rotate": -8.0 * a, "pivot": "top", "translate": [-0.8 * a, -0.35 * a]},
                        "leg_right": {"rotate": 8.0 * a, "pivot": "top", "translate": [0.8 * a, 0.0]},
                        "arm_left": {"rotate": 7.5 * a, "pivot": "top", "translate": [0.4 * a, 0.2 * a]},
                        "arm_right": {"rotate": -7.5 * a, "pivot": "top", "translate": [-0.4 * a, 0.2 * a]},
                        "torso": {"translate": [0.0, 0.35 * a]},
                        "head_unit": {"translate": [0.0, 0.45 * a]},
                    },
                },
                {
                    "name": "walk_1_pass_r",
                    "transforms": {
                        "leg_left": {"rotate": 0.0, "pivot": "top", "translate": [0.0, 0.0]},
                        "leg_right": {"rotate": -3.0 * a, "pivot": "top", "translate": [0.0, -1.15 * a]},
                        "arm_left": {"rotate": 0.0, "pivot": "top"},
                        "arm_right": {"rotate": 0.0, "pivot": "top"},
                        "torso": {"translate": [0.0, -0.45 * a]},
                        "head_unit": {"translate": [0.0, -0.55 * a]},
                    },
                },
                {
                    "name": "walk_2_contact_r",
                    "transforms": {
                        "leg_left": {"rotate": 8.0 * a, "pivot": "top", "translate": [0.8 * a, 0.0]},
                        "leg_right": {"rotate": -8.0 * a, "pivot": "top", "translate": [-0.8 * a, -0.35 * a]},
                        "arm_left": {"rotate": -7.5 * a, "pivot": "top", "translate": [-0.4 * a, 0.2 * a]},
                        "arm_right": {"rotate": 7.5 * a, "pivot": "top", "translate": [0.4 * a, 0.2 * a]},
                        "torso": {"translate": [0.0, 0.35 * a]},
                        "head_unit": {"translate": [0.0, 0.45 * a]},
                    },
                },
                {
                    "name": "walk_3_pass_l",
                    "transforms": {
                        "leg_left": {"rotate": -3.0 * a, "pivot": "top", "translate": [0.0, -1.15 * a]},
                        "leg_right": {"rotate": 0.0, "pivot": "top", "translate": [0.0, 0.0]},
                        "arm_left": {"rotate": 0.0, "pivot": "top"},
                        "arm_right": {"rotate": 0.0, "pivot": "top"},
                        "torso": {"translate": [0.0, -0.45 * a]},
                        "head_unit": {"translate": [0.0, -0.55 * a]},
                    },
                },
            ],
        }

    raise ValueError(f"Unknown preset '{preset}'. Supported presets: 'idle', 'walk'.")


def _format_svg_transform(tf_cfg: dict, pivot_xy: Tuple[float, float]) -> str:
    parts: List[str] = []
    tx, ty = tf_cfg.get("translate", [0.0, 0.0])
    if abs(float(tx)) > 1e-4 or abs(float(ty)) > 1e-4:
        parts.append(f"translate({float(tx):.3g},{float(ty):.3g})")

    rot = float(tf_cfg.get("rotate", 0.0))
    px, py = pivot_xy
    if abs(rot) > 1e-4:
        parts.append(f"rotate({rot:.3g},{px:.2f},{py:.2f})")

    if "scale" in tf_cfg:
        sc = tf_cfg["scale"]
        sx, sy = (float(sc[0]), float(sc[1])) if isinstance(sc, (list, tuple)) else (float(sc), float(sc))
        if abs(sx - 1.0) > 1e-4 or abs(sy - 1.0) > 1e-4:
            parts.append(f"translate({px:.2f},{py:.2f}) scale({sx:.4g},{sy:.4g}) translate({-px:.2f},{-py:.2f})")

    return " ".join(parts)


def _compute_union_bbox(
    ids: Tuple[str, ...],
    bboxes: Dict[str, Tuple[float, float, float, float]],
) -> Optional[Tuple[float, float, float, float]]:
    found = [bboxes[i] for i in ids if i in bboxes]
    if not found:
        return None
    return (
        min(b[0] for b in found),
        min(b[1] for b in found),
        max(b[2] for b in found),
        max(b[3] for b in found),
    )


def generate_posed_frames(
    svg_path: Path,
    spec: dict,
    out_dir: Path,
    reborder: bool = True,
    padding: float = 3.2,
    floor_clip: Optional[float] = 97.0,
) -> List[Path]:
    register_svg_namespaces()
    base_tree = ET.parse(svg_path)
    base_root = base_tree.getroot()
    if parse_viewbox(base_root) is None:
        raise RuntimeError(f"SVG '{svg_path}' is missing a valid viewBox.")

    bboxes = query_svg_bboxes(svg_path)
    head_union_bbox = _compute_union_bbox(("head", "face", "hair_front"), bboxes) or bboxes.get("head")

    frames_cfg = spec.get("frames", [])
    if not frames_cfg:
        raise ValueError("Pose spec contains no 'frames'.")

    out_dir.mkdir(parents=True, exist_ok=True)
    written: List[Path] = []

    for idx, frame_cfg in enumerate(frames_cfg):
        fname = str(frame_cfg.get("name", f"frame_{idx:02d}"))
        frame_root = copy.deepcopy(base_root)
        by_id: Dict[str, ET.Element] = {
            el.attrib["id"]: el for el in frame_root.iter() if "id" in el.attrib
        }

        raw_transforms: Dict[str, dict] = dict(frame_cfg.get("transforms", {}))
        # Expand "head_unit" shorthand across all head-mounted groups sharing the neck pivot
        if "head_unit" in raw_transforms:
            hu_cfg = raw_transforms.pop("head_unit")
            hu_pivot = _resolve_pivot(hu_cfg.get("pivot", "bottom"), head_union_bbox)
            for h_gid in HEAD_UNIT_GROUPS:
                if h_gid in by_id and h_gid not in raw_transforms:
                    expanded = dict(hu_cfg)
                    expanded["pivot"] = [hu_pivot[0], hu_pivot[1]]
                    raw_transforms[h_gid] = expanded

        for target_key, tf_cfg in raw_transforms.items():
            resolved_id = _find_group_aliases(by_id, target_key)
            if resolved_id is None:
                continue
            elem = by_id[resolved_id]
            pivot_xy = _resolve_pivot(tf_cfg.get("pivot", "top"), bboxes.get(resolved_id))
            tf_str = _format_svg_transform(tf_cfg, pivot_xy)
            if tf_str:
                prev_tf = elem.attrib.get("transform", "").strip()
                elem.attrib["transform"] = f"{tf_str} {prev_tf}".strip()

        for hid in frame_cfg.get("hide", []):
            if hid in by_id:
                by_id[hid].attrib["display"] = "none"

        for sid in frame_cfg.get("show", []):
            if sid in by_id:
                by_id[sid].attrib.pop("display", None)
                if "style" in by_id[sid].attrib:
                    by_id[sid].attrib["style"] = by_id[sid].attrib["style"].replace("display:none", "display:inline")

        frame_path = out_dir / f"{svg_path.stem}_{fname}.svg"
        frame_tree = ET.ElementTree(frame_root)
        ET.indent(frame_tree, space="  ")
        frame_tree.write(frame_path, encoding="utf-8", xml_declaration=True)

        if reborder:
            generate_cutout_border(
                svg_path=frame_path,
                out_path=frame_path,
                padding=padding,
                floor_clip=floor_clip,
                replace_backdrop=True,
            )

        written.append(frame_path)

    return written


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate puppet-posed SVG animation frames (and optional packed spritesheet) from a rigged SVG."
    )
    parser.add_argument("svg", type=Path, help="Input rigged .svg file.")
    parser.add_argument("--preset", type=str, choices=["idle", "walk"], default=None, help="Built-in puppet animation preset.")
    parser.add_argument("--amplitude", type=float, default=1.0, help="Motion scale multiplier for --preset (default: 1.0).")
    parser.add_argument("--spec", type=Path, default=None, help="Custom JSON pose specification file.")
    parser.add_argument("--out-dir", type=Path, default=None, help="Directory for generated frame SVGs.")
    parser.add_argument("--pack", type=Path, default=None, help="Optional output path to pack generated frames into a spritesheet .svg.")
    parser.add_argument("--padding", type=float, default=3.2, help="Cutout border padding in SVG units (default: 3.2).")
    parser.add_argument("--floor-clip", type=float, default=97.0, help="Flat bottom border clip Y (default: 97.0).")
    parser.add_argument("--no-floor-clip", action="store_true", help="Disable flat bottom border trimming.")
    parser.add_argument("--no-border", action="store_true", help="Skip regenerating cutout_border per frame.")
    args = parser.parse_args(argv)

    svg_path = args.svg.resolve()
    if not svg_path.is_file():
        print(f"[FAIL] SVG file not found: {svg_path}", file=sys.stderr)
        return 1

    if args.spec is not None:
        spec_path = args.spec.resolve()
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        tag_label = spec_path.stem
    elif args.preset is not None:
        spec = build_preset_spec(args.preset, amplitude=args.amplitude)
        tag_label = args.preset
    else:
        parser.error("Provide either --preset {idle,walk} or --spec <poses.json>.")

    if args.out_dir:
        out_dir = args.out_dir.resolve()
    else:
        cand = DEFAULT_PREVIEW_DIR.parent / "svg-poses" / f"{svg_path.stem}_{tag_label}"
        try:
            cand.mkdir(parents=True, exist_ok=True)
            out_dir = cand
        except OSError:
            out_dir = Path(tempfile.gettempdir()) / "stapler-svg-poses" / f"{svg_path.stem}_{tag_label}"
    floor_clip = None if args.no_floor_clip else float(spec.get("floorClip", args.floor_clip))

    written = generate_posed_frames(
        svg_path=svg_path,
        spec=spec,
        out_dir=out_dir,
        reborder=not args.no_border,
        padding=float(spec.get("padding", args.padding)),
        floor_clip=floor_clip,
    )

    print(f"Generated {len(written)} posed SVG frames in {out_dir}:")
    for p in written:
        print(f"  - {p.name}")

    if args.pack is not None:
        pack_out = args.pack.resolve()
        cols = len(written)
        rows = 1
        cells = [(idx, 0, p) for idx, p in enumerate(written)]
        pack_spritesheet(cells=cells, cols=cols, rows=rows, out_path=pack_out)
        print(f"Packed {cols}x{rows} spritesheet: {pack_out}")
        clip_name = args.preset or tag_label
        _print_manifest_snippet(
            sprite_id=svg_path.stem,
            out_path=pack_out,
            cols=cols,
            rows=rows,
            world_height=2.0,
            animations={
                clip_name: {
                    "row": 0,
                    "frames": cols,
                    "fps": int(spec.get("fps", 6)),
                    "loop": bool(spec.get("loop", True)),
                }
            },
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
