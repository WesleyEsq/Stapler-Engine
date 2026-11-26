#!/usr/bin/env python3
"""Compile Inkscape walk workbooks + idle SVGs into a bordered engine spritesheet, preview PNG, and animated GIF."""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from svg_border import generate_cutout_border
from svg_common import (
    DEFAULT_PREVIEW_DIR,
    INKSCAPE_NS,
    SVG_NS,
    local_tag,
    parse_viewbox,
    preview_output_path,
    register_svg_namespaces,
    render_svg_to_png,
)
from svg_pack import SKIP_ROOT_TAGS, _print_manifest_snippet, pack_spritesheet
from svg_preview import main as preview_main

GUIDE_LAYER_IDS = {"stapler_guides", "guides"}
FRAME_ID_RE = re.compile(r"^frame_(\d+)$")


def _load_font(size: int = 12) -> ImageFont.ImageFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf",
        "/usr/share/fonts/liberation-mono/LiberationMono-Regular.ttf",
    ):
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                pass
    return ImageFont.load_default()


def _is_guide_layer(elem: ET.Element) -> bool:
    eid = elem.attrib.get("id", "").strip().lower()
    lbl = elem.attrib.get(f"{{{INKSCAPE_NS}}}label", "").strip().lower()
    return eid in GUIDE_LAYER_IDS or lbl.startswith("guides") or lbl.startswith("stapler_guides")


def extract_workbook_frames(
    workbook_svg: Path,
    tmp_dir: Path,
    cell_size: float = 100.0,
) -> List[Path]:
    """Slice `frame_0..frame_N` layers from an Inkscape workbook into standalone `100x100` frame SVGs."""
    register_svg_namespaces()
    root = ET.parse(workbook_svg).getroot()
    vb = parse_viewbox(root)
    if vb is None:
        raise RuntimeError(f"Workbook '{workbook_svg}' is missing a valid viewBox.")

    defs_nodes = [copy.deepcopy(c) for c in list(root) if local_tag(c) == "defs"]
    numbered_layers: List[Tuple[int, ET.Element]] = []
    extra_layers: List[str] = []

    for child in list(root):
        tag = local_tag(child)
        if tag in SKIP_ROOT_TAGS or tag == "defs":
            continue
        if _is_guide_layer(child):
            continue
        eid = child.attrib.get("id", "")
        m = FRAME_ID_RE.match(eid)
        if tag == "g" and m:
            numbered_layers.append((int(m.group(1)), child))
        else:
            extra_layers.append(eid or f"<{tag}>")

    if extra_layers:
        print(
            f"  [WARN] Non-frame elements in '{workbook_svg.name}' were ignored "
            f"(place artwork inside frame_0..frame_3): {', '.join(extra_layers[:6])}"
        )

    if not numbered_layers:
        raise RuntimeError(
            f"Workbook '{workbook_svg}' contains no <g id='frame_0'>.. layers. "
            "Create workbooks with 'npm run svg:workbook'."
        )

    numbered_layers.sort(key=lambda pair: pair[0])
    out_frames: List[Path] = []

    for idx, (frame_num, layer_elem) in enumerate(numbered_layers):
        frame_root = ET.Element(
            f"{{{SVG_NS}}}svg",
            {
                "version": "1.1",
                "width": f"{cell_size:g}mm",
                "height": f"{cell_size:g}mm",
                "viewBox": f"0 0 {cell_size:g} {cell_size:g}",
            },
        )
        for dnode in defs_nodes:
            frame_root.append(copy.deepcopy(dnode))

        cloned_layer = copy.deepcopy(layer_elem)
        # Strip the workbook horizontal cell offset `translate(frame_num * cell_size, 0)` cleanly
        tf = cloned_layer.attrib.get("transform", "").strip()
        expected_x = frame_num * cell_size
        stripped_tf = re.sub(
            rf"translate\(\s*{expected_x:g}(?:\.0+)?(?:\s*[,\s]\s*0(?:\.0+)?)?\s*\)",
            "",
            tf,
            count=1,
        ).strip()
        if stripped_tf:
            cloned_layer.attrib["transform"] = stripped_tf
        else:
            cloned_layer.attrib.pop("transform", None)

        # Ensure outer cell is a regular group so border injection inserts cleanly inside it
        cloned_layer.attrib.pop(f"{{{INKSCAPE_NS}}}groupmode", None)
        frame_root.append(cloned_layer)

        frame_path = tmp_dir / f"{workbook_svg.stem}_f{idx}.svg"
        tree = ET.ElementTree(frame_root)
        ET.indent(tree, space="  ")
        tree.write(frame_path, encoding="utf-8", xml_declaration=True)
        out_frames.append(frame_path)

    return out_frames


def render_animated_gif(
    frame_svgs: List[Path],
    out_gif: Path,
    title: str,
    fps: int = 7,
    cell_px: int = 256,
) -> Path:
    """Render a 3-up animated GIF loop (Right | Mirrored Left | alphaTest=0.5 Shadow) for visual motion review."""
    font = _load_font(12)
    hdr_h = 26
    gap = 4
    total_w = cell_px * 3 + gap * 4
    total_h = hdr_h + cell_px + gap * 2
    floor_y = int(round(0.96 * cell_px))

    gif_frames: List[Image.Image] = []
    with tempfile.TemporaryDirectory(prefix="stapler_gif_frames_") as tmp:
        tmp_dir = Path(tmp)
        for idx, fsvg in enumerate(frame_svgs):
            raw_png = tmp_dir / f"f{idx}.png"
            render_svg_to_png(fsvg, raw_png, cell_px, cell_px)
            art = Image.open(raw_png).convert("RGBA")
            mirrored = art.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

            # Shadow mask matching alphaTest = 0.5
            alpha = art.getchannel("A")
            hard_mask = alpha.point(lambda a: 255 if a >= 128 else 0)
            shadow_tile = Image.new("RGBA", (cell_px, cell_px), (232, 226, 213, 255))
            shadow_tile.paste(Image.new("RGBA", (cell_px, cell_px), (29, 31, 38, 255)), (0, 0), hard_mask)

            # Snow-tinted light surface for normal & mirrored walk tiles
            right_tile = Image.new("RGBA", (cell_px, cell_px), (225, 232, 240, 255))
            left_tile = Image.new("RGBA", (cell_px, cell_px), (43, 45, 56, 255))
            for tile_img, line_col in (
                (right_tile, (40, 165, 145, 220)),
                (left_tile, (69, 227, 193, 220)),
                (shadow_tile, (215, 95, 75, 200)),
            ):
                tdraw = ImageDraw.Draw(tile_img)
                tdraw.line([(0, floor_y), (cell_px, floor_y)], fill=line_col, width=2)

            right_tile.alpha_composite(art, (0, 0))
            left_tile.alpha_composite(mirrored, (0, 0))

            canvas = Image.new("RGBA", (total_w, total_h), (64, 68, 86, 255))
            cdraw = ImageDraw.Draw(canvas)
            cdraw.rectangle([0, 0, total_w, hdr_h], fill=(22, 24, 32, 255))
            cdraw.text(
                (10, 6),
                f"{title}  |  {fps} fps  |  frame {idx + 1}/{len(frame_svgs)}   [1: Snow Right | 2: Dark Left (Flip) | 3: Shadow]",
                fill=(235, 238, 245, 255),
                font=font,
            )

            canvas.paste(right_tile, (gap, hdr_h + gap))
            canvas.paste(left_tile, (gap * 2 + cell_px, hdr_h + gap))
            canvas.paste(shadow_tile, (gap * 3 + cell_px * 2, hdr_h + gap))
            gif_frames.append(canvas.convert("P", palette=Image.Palette.ADAPTIVE, colors=255))

    duration_ms = max(40, int(round(1000.0 / max(1, fps))))
    try:
        out_gif.parent.mkdir(parents=True, exist_ok=True)
        gif_frames[0].save(
            out_gif,
            save_all=True,
            append_images=gif_frames[1:],
            duration=duration_ms,
            loop=0,
            disposal=2,
        )
    except OSError:
        out_gif = Path(tempfile.gettempdir()) / "stapler-svg-previews" / out_gif.name
        out_gif.parent.mkdir(parents=True, exist_ok=True)
        gif_frames[0].save(
            out_gif,
            save_all=True,
            append_images=gif_frames[1:],
            duration=duration_ms,
            loop=0,
            disposal=2,
        )
    return out_gif


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compile Inkscape walk workbooks & idle SVGs into a bordered spritesheet, preview PNG, and animated GIF."
    )
    parser.add_argument("input", type=Path, help="Path to a sheet recipe .json OR a single workbook .svg.")
    parser.add_argument("--out", type=Path, default=None, help="Output spritesheet .svg path (overrides JSON 'out').")
    parser.add_argument("--fps", type=int, default=7, help="Default FPS for direct workbook compilation (default: 7).")
    parser.add_argument("--padding", type=float, default=3.2, help="Cutout border padding in SVG units (default: 3.2).")
    parser.add_argument("--floor-clip", type=float, default=97.0, help="Flat bottom border clip Y (default: 97.0).")
    parser.add_argument("--no-gif", action="store_true", help="Skip generating animated GIF loop preview.")
    parser.add_argument("--no-preview", action="store_true", help="Skip generating 4-panel PNG preview.")
    parser.add_argument("--gif-out", type=Path, default=None, help="Optional custom output path for the animated GIF.")
    parser.add_argument("--preview-out", type=Path, default=None, help="Optional custom output path for the 4-panel PNG.")
    args = parser.parse_args(argv)

    in_path = args.input.resolve()
    if not in_path.is_file():
        print(f"[FAIL] Input file not found: {in_path}", file=sys.stderr)
        return 1

    if in_path.suffix.lower() == ".json":
        cfg = json.loads(in_path.read_text(encoding="utf-8"))
        base_dir = in_path.parent
        sprite_id = str(cfg.get("id", in_path.stem))
        out_path = (args.out or (base_dir / cfg["out"])).resolve()
        world_height = float(cfg.get("worldHeight", 2.0))
        cell_size = float(cfg.get("cellSize", 100.0))
        padding = float(cfg.get("padding", args.padding))
        floor_clip = float(cfg.get("floorClip", args.floor_clip))
        anim_specs: Dict[str, dict] = cfg["animations"]
        forced_cols: Optional[int] = int(cfg["columns"]) if "columns" in cfg else None
    else:
        base_dir = in_path.parent
        sprite_id = in_path.stem.replace("_workbook", "")
        out_path = (args.out or (DEFAULT_PREVIEW_DIR.parent / "svg-sheets" / f"{sprite_id}_sheet.svg")).resolve()
        world_height = 2.0
        cell_size = 100.0
        padding = args.padding
        floor_clip = args.floor_clip
        anim_specs = {
            "walk_front": {
                "row": 0,
                "fps": args.fps,
                "loop": True,
                "workbook": in_path.name,
            }
        }
        forced_cols = None

    with tempfile.TemporaryDirectory(prefix="stapler_compile_sheet_") as tmp:
        tmp_dir = Path(tmp)
        cells: List[Tuple[int, int, Path]] = []
        manifest_anims: Dict[str, dict] = {}
        gif_targets: List[Tuple[str, int, List[Path]]] = []
        max_col_count = 1
        max_row_idx = 0

        for clip_name, clip_cfg in anim_specs.items():
            row_idx = int(clip_cfg["row"])
            fps = int(clip_cfg.get("fps", args.fps))
            loop = bool(clip_cfg.get("loop", True))
            reborder = bool(clip_cfg.get("reborder", True))

            clip_frames: List[Path] = []
            if "workbook" in clip_cfg:
                wb_path = (base_dir / clip_cfg["workbook"]).resolve()
                extracted = extract_workbook_frames(wb_path, tmp_dir, cell_size=cell_size)
                for fpath in extracted:
                    if reborder:
                        generate_cutout_border(
                            svg_path=fpath,
                            out_path=fpath,
                            padding=padding,
                            floor_clip=floor_clip,
                            replace_backdrop=True,
                        )
                    clip_frames.append(fpath)
            elif "frames" in clip_cfg:
                for idx, rel in enumerate(clip_cfg["frames"]):
                    src = (base_dir / rel).resolve()
                    staged = tmp_dir / f"{clip_name}_{idx}.svg"
                    staged.write_bytes(src.read_bytes())
                    if reborder:
                        generate_cutout_border(
                            svg_path=staged,
                            out_path=staged,
                            padding=padding,
                            floor_clip=floor_clip,
                            replace_backdrop=True,
                        )
                    clip_frames.append(staged)
            else:
                raise RuntimeError(f"Animation clip '{clip_name}' must specify either 'workbook' or 'frames'.")

            max_col_count = max(max_col_count, len(clip_frames))
            max_row_idx = max(max_row_idx, row_idx)
            for col_idx, fpath in enumerate(clip_frames):
                cells.append((col_idx, row_idx, fpath))

            manifest_anims[clip_name] = {
                "row": row_idx,
                "frames": len(clip_frames),
                "fps": fps,
                "loop": loop,
            }
            if len(clip_frames) > 1:
                gif_targets.append((clip_name, fps, clip_frames))

        cols = forced_cols or max_col_count
        rows = max_row_idx + 1
        pack_spritesheet(cells=cells, cols=cols, rows=rows, out_path=out_path, cell_size=cell_size)
        print(f"Compiled {cols}x{rows} spritesheet ({len(cells)} frames): {out_path}")
        _print_manifest_snippet(sprite_id, out_path, cols, rows, world_height, manifest_anims)

        if not args.no_gif:
            for clip_name, fps, clip_frames in gif_targets:
                gif_path = (
                    args.gif_out.resolve()
                    if (args.gif_out is not None and len(gif_targets) == 1)
                    else preview_output_path(f"{sprite_id}_{clip_name}", "_anim.gif")
                )
                saved_gif = render_animated_gif(
                    frame_svgs=clip_frames,
                    out_gif=gif_path,
                    title=f"{sprite_id} / {clip_name}",
                    fps=fps,
                )
                print(f"Animated GIF Preview: {saved_gif}")

    if not args.no_preview:
        prev_argv = [str(out_path), "--sheet", f"{cols}x{rows}"]
        if args.preview_out is not None:
            prev_argv.extend(["--out", str(args.preview_out.resolve())])
        preview_main(prev_argv)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
