#!/usr/bin/env python3
"""Generate and inject an idempotent paper-cutout sticker border (#f9f9f9) into an SVG."""

from __future__ import annotations

import argparse
import copy
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw

from svg_common import (
    INKSCAPE_NS,
    SVG_NS,
    effective_prop,
    local_tag,
    parse_viewbox,
    register_svg_namespaces,
    render_svg_to_png,
    require_binary,
)

TOKEN_RE = re.compile(r"[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
LIGHT_BACKDROP_FILLS = {"#f9f9f9", "#fafafa", "#ffffff", "white"}


def _remove_existing_border(root: ET.Element, border_id: str, replace_backdrop: bool = False) -> int:
    removed = 0
    for parent in root.iter():
        to_remove = [child for child in list(parent) if child.attrib.get("id") == border_id]
        for child in to_remove:
            parent.remove(child)
            removed += 1

    if removed == 0 and replace_backdrop:
        # Also check if the very first visual shape in the primary layer is a hand-drawn #f9f9f9 backdrop
        target_parent = _find_insertion_parent(root)
        for child in list(target_parent):
            tag = local_tag(child)
            if tag in ("defs", "namedview", "metadata", "title", "desc"):
                continue
            if tag in ("path", "polygon", "rect") and effective_prop(child, "fill") in LIGHT_BACKDROP_FILLS:
                target_parent.remove(child)
                removed += 1
            break
    return removed


def _find_insertion_parent(root: ET.Element) -> ET.Element:
    """Return the primary Inkscape layer <g> if present, otherwise <svg> root."""
    for child in root:
        if local_tag(child) == "g":
            if child.attrib.get(f"{{{INKSCAPE_NS}}}groupmode") == "layer":
                return child
    # Fall back to single top-level <g> wrapper if there is exactly one
    top_groups = [c for c in root if local_tag(c) == "g"]
    if len(top_groups) == 1:
        return top_groups[0]
    return root


def _fill_internal_holes(mask_l: Image.Image) -> Image.Image:
    """Fill enclosed holes inside a binary L-mode mask (foreground=255, background=0)."""
    w, h = mask_l.size
    padded = Image.new("L", (w + 2, h + 2), 0)
    padded.paste(mask_l, (1, 1))
    # Flood-fill exterior background with 128; anything still 0 is an enclosed hole
    ImageDraw.floodfill(padded, (0, 0), 128)
    filled = padded.crop((1, 1, w + 1, h + 1)).point(lambda v: 0 if v == 128 else 255)
    return filled


def _transform_potrace_path(
    d_str: str,
    tx: float,
    ty: float,
    sx: float,
    sy: float,
    vb_min_x: float,
    vb_min_y: float,
    vb_w: float,
    vb_h: float,
    render_w: int,
    render_h: int,
) -> str:
    """Bake potrace's `<g transform='translate(...) scale(...)'>` directly into SVG viewBox coordinates."""
    # Map potrace path point (px, py) -> bitmap px (bx, by) -> viewBox (vx, vy)
    scale_x = sx * (vb_w / render_w)
    scale_y = sy * (vb_h / render_h)
    off_x = vb_min_x + tx * (vb_w / render_w)
    off_y = vb_min_y + ty * (vb_h / render_h)

    tokens = TOKEN_RE.findall(d_str)
    out: List[str] = []
    idx = 0
    cmd = ""

    def fmt(val: float) -> str:
        s = f"{val:.2f}".rstrip("0").rstrip(".")
        return "0" if s == "-0" else s

    def next_num() -> float:
        nonlocal idx
        val = float(tokens[idx])
        idx += 1
        return val

    while idx < len(tokens):
        tok = tokens[idx]
        if tok.isalpha():
            cmd = tok
            idx += 1
            if cmd in ("Z", "z"):
                out.append("Z")
            continue

        if cmd in ("M", "L", "T"):
            x, y = next_num(), next_num()
            out.append(f"{cmd}{fmt(off_x + x * scale_x)},{fmt(off_y + y * scale_y)}")
            if cmd == "M":
                cmd = "L"
        elif cmd in ("m", "l", "t"):
            dx, dy = next_num(), next_num()
            out.append(f"{cmd}{fmt(dx * scale_x)},{fmt(dy * scale_y)}")
            if cmd == "m":
                cmd = "l"
        elif cmd == "H":
            x = next_num()
            out.append(f"H{fmt(off_x + x * scale_x)}")
        elif cmd == "h":
            dx = next_num()
            out.append(f"h{fmt(dx * scale_x)}")
        elif cmd == "V":
            y = next_num()
            out.append(f"V{fmt(off_y + y * scale_y)}")
        elif cmd == "v":
            dy = next_num()
            out.append(f"v{fmt(dy * scale_y)}")
        elif cmd == "C":
            coords = [next_num() for _ in range(6)]
            pts = [
                f"{fmt(off_x + coords[i] * scale_x)},{fmt(off_y + coords[i + 1] * scale_y)}"
                for i in (0, 2, 4)
            ]
            out.append("C" + " ".join(pts))
        elif cmd == "c":
            coords = [next_num() for _ in range(6)]
            pts = [
                f"{fmt(coords[i] * scale_x)},{fmt(coords[i + 1] * scale_y)}"
                for i in (0, 2, 4)
            ]
            out.append("c" + " ".join(pts))
        elif cmd == "S" or cmd == "Q":
            coords = [next_num() for _ in range(4)]
            pts = [
                f"{fmt(off_x + coords[i] * scale_x)},{fmt(off_y + coords[i + 1] * scale_y)}"
                for i in (0, 2)
            ]
            out.append(cmd + " ".join(pts))
        elif cmd == "s" or cmd == "q":
            coords = [next_num() for _ in range(4)]
            pts = [
                f"{fmt(coords[i] * scale_x)},{fmt(coords[i + 1] * scale_y)}"
                for i in (0, 2)
            ]
            out.append(cmd + " ".join(pts))
        else:
            raise RuntimeError(f"Unsupported SVG path command '{cmd}' in potrace output.")

    return " ".join(out)


def _parse_potrace_svg(
    potrace_svg: Path,
    vb: Tuple[float, float, float, float],
    render_w: int,
    render_h: int,
) -> str:
    root = ET.parse(potrace_svg).getroot()
    tx, ty, sx, sy = 0.0, float(render_h), 0.1, -0.1

    g_elem = None
    for elem in root.iter():
        if local_tag(elem) == "g" and "transform" in elem.attrib:
            g_elem = elem
            break

    if g_elem is not None:
        tf = g_elem.attrib.get("transform", "")
        m_tr = re.search(r"translate\(\s*([^,\s)]+)[,\s]+([^)]+)\)", tf)
        m_sc = re.search(r"scale\(\s*([^,\s)]+)[,\s]+([^)]+)\)", tf)
        if m_tr:
            tx, ty = float(m_tr.group(1)), float(m_tr.group(2))
        if m_sc:
            sx, sy = float(m_sc.group(1)), float(m_sc.group(2))

    parts: List[str] = []
    min_x, min_y, vb_w, vb_h = vb
    for elem in root.iter():
        if local_tag(elem) == "path" and elem.attrib.get("d"):
            baked = _transform_potrace_path(
                elem.attrib["d"], tx, ty, sx, sy, min_x, min_y, vb_w, vb_h, render_w, render_h
            )
            if baked:
                parts.append(baked)

    if not parts:
        raise RuntimeError("Potrace produced no vector paths from the dilated silhouette mask.")
    return " ".join(parts)


def generate_cutout_border(
    svg_path: Path,
    out_path: Path,
    padding: float = 3.2,
    close_radius: float = 1.2,
    color: str = "#f9f9f9",
    border_id: str = "cutout_border",
    keep_holes: bool = False,
    opttolerance: float = 0.45,
    floor_clip: Optional[float] = 97.0,
    replace_backdrop: bool = False,
) -> Tuple[bool, Tuple[float, float, float, float]]:
    """Bake a smooth paper-cutout border path into `out_path`.

    Returns `(clipped, border_bbox_svg)`.
    """
    magick = require_binary("magick", "install ImageMagick for circular silhouette dilation")
    potrace = require_binary("potrace", "install potrace to trace smooth SVG sticker outlines")
    register_svg_namespaces()

    tree = ET.parse(svg_path)
    root = tree.getroot()
    vb = parse_viewbox(root)
    if vb is None:
        raise RuntimeError(f"SVG '{svg_path}' is missing a valid viewBox attribute.")

    min_x, min_y, vb_w, vb_h = vb
    # Work on a clean borderless copy for rasterization
    clean_root = copy.deepcopy(root)
    _remove_existing_border(clean_root, border_id, replace_backdrop=replace_backdrop)

    scale = min(5.0, 2000.0 / max(vb_w, vb_h))
    render_w = max(64, int(round(vb_w * scale)))
    render_h = max(64, int(round(vb_h * scale)))

    with tempfile.TemporaryDirectory(prefix="stapler_svg_border_") as tmp:
        tmp_dir = Path(tmp)
        clean_svg = tmp_dir / "borderless.svg"
        ET.ElementTree(clean_root).write(clean_svg, encoding="utf-8", xml_declaration=True)

        rendered_png = tmp_dir / "borderless.png"
        render_svg_to_png(clean_svg, rendered_png, render_w, render_h)

        alpha = Image.open(rendered_png).convert("RGBA").getchannel("A")
        hard_mask = alpha.point(lambda a: 255 if a >= 128 else 0)
        if hard_mask.getbbox() is None:
            raise RuntimeError(f"SVG '{svg_path}' has no opaque pixels (after removing '{border_id}').")

        mask_in = tmp_dir / "mask_in.png"
        mask_dilated = tmp_dir / "mask_dilated.png"
        hard_mask.save(mask_in, format="PNG")

        pad_px = max(1.0, padding * scale)
        close_px = max(0.0, close_radius * scale)

        cmd = [magick, str(mask_in), "-morphology", "Dilate", f"Disk:{pad_px:.2f}"]
        if close_px >= 1.0:
            cmd.extend(["-morphology", "Close", f"Disk:{close_px:.2f}"])
        cmd.extend(["-threshold", "50%", str(mask_dilated)])

        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0 or not mask_dilated.is_file():
            raise RuntimeError(f"ImageMagick dilation failed:\n{proc.stderr.strip()}")

        dilated_img = Image.open(mask_dilated).convert("L").point(lambda v: 255 if v >= 128 else 0)
        if not keep_holes:
            dilated_img = _fill_internal_holes(dilated_img)

        # Trim paper standee base flat along floor_clip (e.g. y=97.0) so cutouts sit flush on the floor
        if floor_clip is not None and min_y < floor_clip < (min_y + vb_h):
            clip_py = int(round(((floor_clip - min_y) / vb_h) * render_h))
            if 0 < clip_py < render_h:
                clip_draw = ImageDraw.Draw(dilated_img)
                clip_draw.rectangle([0, clip_py, render_w, render_h], fill=0)

        bbox = dilated_img.getbbox()
        if bbox is None:
            raise RuntimeError("Dilated border mask is unexpectedly empty.")

        bx0, by0, bx1, by1 = bbox
        clipped = bx0 <= 0 or by0 <= 0 or bx1 >= render_w or by1 >= render_h
        border_bbox_svg = (
            min_x + (bx0 / render_w) * vb_w,
            min_y + (by0 / render_h) * vb_h,
            min_x + (bx1 / render_w) * vb_w,
            min_y + (by1 / render_h) * vb_h,
        )

        # Potrace traces BLACK pixels on a WHITE background -> invert mask
        pbm_path = tmp_dir / "mask.pbm"
        inv_mask = dilated_img.point(lambda v: 0 if v >= 128 else 255).convert("1")
        inv_mask.save(pbm_path, format="PPM")

        traced_svg = tmp_dir / "traced.svg"
        potrace_cmd = [
            potrace,
            str(pbm_path),
            "--svg",
            "--flat",
            "--turdsize",
            "32",
            "--alphamax",
            "1.2",
            "--opttolerance",
            f"{opttolerance:.2f}",
            "-o",
            str(traced_svg),
        ]
        p_proc = subprocess.run(potrace_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if p_proc.returncode != 0 or not traced_svg.is_file():
            raise RuntimeError(f"Potrace failed:\n{p_proc.stderr.strip()}")

        d_baked = _parse_potrace_svg(traced_svg, vb, render_w, render_h)

    # Inject clean <path id="cutout_border"> as the first child of the primary layer
    _remove_existing_border(root, border_id, replace_backdrop=replace_backdrop)
    target_parent = _find_insertion_parent(root)
    border_elem = ET.Element(
        f"{{{SVG_NS}}}path",
        {
            "id": border_id,
            "fill": color,
            "stroke": "none",
            "d": d_baked,
        },
    )

    # Insert after <defs>/<sodipodi:namedview>/<metadata> if inserting directly into <svg>
    insert_idx = 0
    if target_parent is root:
        for i, child in enumerate(list(root)):
            if local_tag(child) in ("defs", "namedview", "metadata", "title", "desc"):
                insert_idx = i + 1
            else:
                break
    target_parent.insert(insert_idx, border_elem)

    ET.indent(tree, space="  ")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_path, encoding="utf-8", xml_declaration=True)
    return clipped, border_bbox_svg


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Auto-generate an idempotent #f9f9f9 paper-cutout sticker border for a Stapler Engine SVG."
    )
    parser.add_argument("svg", type=Path, help="Input .svg file.")
    parser.add_argument("--out", type=Path, default=None, help="Output .svg path (defaults to modifying input in-place).")
    parser.add_argument("--padding", type=float, default=3.2, help="Border padding in SVG units (default: 3.2).")
    parser.add_argument("--close", type=float, default=1.2, help="Morphological close radius in SVG units to smooth tight gaps (default: 1.2).")
    parser.add_argument("--color", type=str, default="#f9f9f9", help="Cutout fill hex color (default: #f9f9f9).")
    parser.add_argument("--id", dest="border_id", type=str, default="cutout_border", help="Element id for the border path (default: cutout_border).")
    parser.add_argument("--keep-holes", action="store_true", help="Keep interior holes inside the silhouette instead of solidifying the sticker.")
    parser.add_argument("--opttolerance", type=float, default=0.45, help="Potrace curve smoothing tolerance (default: 0.45).")
    parser.add_argument("--floor-clip", type=float, default=97.0, help="Trim bottom of cutout border flat at this SVG Y coordinate (default: 97.0, matching Unua).")
    parser.add_argument("--no-floor-clip", action="store_true", help="Disable flat bottom floor trimming (for floating props like clouds).")
    parser.add_argument("--replace-backdrop", action="store_true", help="Also replace a leading hand-drawn #f9f9f9 backdrop path if id='cutout_border' is not set yet.")
    args = parser.parse_args(argv)

    svg_path = args.svg.resolve()
    if not svg_path.is_file():
        print(f"[FAIL] SVG file not found: {svg_path}", file=sys.stderr)
        return 1

    out_path = args.out.resolve() if args.out else svg_path
    floor_clip = None if args.no_floor_clip else args.floor_clip
    clipped, (x0, y0, x1, y1) = generate_cutout_border(
        svg_path=svg_path,
        out_path=out_path,
        padding=args.padding,
        close_radius=args.close,
        color=args.color,
        border_id=args.border_id,
        keep_holes=args.keep_holes,
        opttolerance=args.opttolerance,
        floor_clip=floor_clip,
        replace_backdrop=args.replace_backdrop,
    )

    print(f"Cutout border written: {out_path}")
    print(f"  id='{args.border_id}', fill='{args.color}', padding={args.padding:g}u")
    print(f"  border bbox: x=[{x0:.1f}..{x1:.1f}], y=[{y0:.1f}..{y1:.1f}]")
    if clipped:
        print("  [WARN] Generated border touches the viewBox edge! Consider scaling the character slightly or reducing --padding.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
