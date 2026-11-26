#!/usr/bin/env python3
"""Inspect an SVG's true rendered element coordinates (0..100 viewBox) and render an ID callout map."""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from svg_common import (
    DEFAULT_PREVIEW_DIR,
    INKSCAPE_NS,
    effective_prop,
    local_tag,
    parse_viewbox,
    preview_output_path,
    query_svg_bboxes,
    render_svg_to_png,
)

VISUAL_LEAF_TAGS = {"path", "rect", "ellipse", "circle", "polygon", "polyline", "line", "use", "text"}
SKIP_SUBTREES = {"defs", "namedview", "metadata", "title", "desc"}
LIGHT_BACKING_FILLS = {"#f9f9f9", "#fafafa", "#ffffff", "white"}
DEGENERATE_LINE_PATH_RE = re.compile(
    r"^\s*[Mm]\s*[-+\d.eE]+[\s,]+[-+\d.eE]+\s*[Ll]?\s*[-+\d.eE]+[\s,]+[-+\d.eE]+\s*[Zz]?\s*$"
)


@dataclass
class ElementInfo:
    z_index: int
    eid: str
    tag: str
    group_path: str
    label: str
    fill: str
    stroke: str
    has_transform: bool
    bbox: Optional[Tuple[float, float, float, float]]
    flags: List[str]


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


def collect_elements(
    root: ET.Element,
    bboxes: Dict[str, Tuple[float, float, float, float]],
    vb: Tuple[float, float, float, float],
) -> Tuple[List[ElementInfo], List[Tuple[str, str, Optional[Tuple[float, float, float, float]]]]]:
    leaves: List[ElementInfo] = []
    groups: List[Tuple[str, str, Optional[Tuple[float, float, float, float]]]] = []
    vb_h = vb[3]

    def walk(node: ET.Element, ancestors: List[str]) -> None:
        for child in list(node):
            tag = local_tag(child)
            if tag in SKIP_SUBTREES:
                continue
            eid = child.attrib.get("id", "")
            ink_label = child.attrib.get(f"{{{INKSCAPE_NS}}}label", "")

            if tag == "g":
                seg = f"{eid}({ink_label})" if ink_label and ink_label != eid else (eid or "<g>")
                groups.append((eid or "<g>", ink_label, bboxes.get(eid)))
                walk(child, ancestors + [seg])
                continue

            if tag not in VISUAL_LEAF_TAGS:
                walk(child, ancestors)
                continue

            fill = effective_prop(child, "fill") or "(default)"
            stroke = effective_prop(child, "stroke") or "none"
            has_tf = "transform" in child.attrib
            bbox = bboxes.get(eid)
            flags: List[str] = []

            if has_tf:
                flags.append("transform")

            if tag == "path":
                d_str = child.attrib.get("d", "")
                if DEGENERATE_LINE_PATH_RE.match(d_str) and stroke in ("none", ""):
                    flags.append("ZERO-AREA(no-stroke)")

            if bbox is not None:
                x0, y0, x1, y1 = bbox
                w, h = x1 - x0, y1 - y0
                if (w < 0.08 or h < 0.08) and stroke in ("none", ""):
                    if "ZERO-AREA(no-stroke)" not in flags:
                        flags.append("tiny/invisible")
                if len(leaves) == 0 and fill in LIGHT_BACKING_FILLS and h > 0.45 * vb_h:
                    flags.append("BACKDROP")

            leaves.append(
                ElementInfo(
                    z_index=len(leaves) + 1,
                    eid=eid or f"<{tag}>",
                    tag=tag,
                    group_path="/".join(ancestors) if ancestors else "(root)",
                    label=ink_label,
                    fill=fill,
                    stroke=stroke,
                    has_transform=has_tf,
                    bbox=bbox,
                    flags=flags,
                )
            )

    walk(root, [])
    return leaves, groups


def _parse_hex_rgb(color: str) -> Optional[Tuple[int, int, int]]:
    if re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
    if re.fullmatch(r"#[0-9a-fA-F]{3}", color):
        return int(color[1] * 2, 16), int(color[2] * 2, 16), int(color[3] * 2, 16)
    return None


def render_annotated_map(
    svg_path: Path,
    vb: Tuple[float, float, float, float],
    leaves: List[ElementInfo],
    out_path: Path,
) -> None:
    """Render a clear callout diagram mapping every element ID to its visual position."""
    canvas_w, canvas_h = 1240, 860
    art_size = 640
    art_x = (canvas_w - art_size) // 2
    art_y = 64

    sheet = Image.new("RGBA", (canvas_w, canvas_h), (30, 32, 42, 255))
    overlay = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    ov_draw = ImageDraw.Draw(overlay)
    font_hdr = _load_font(14)
    font_sm = _load_font(11)

    draw.rectangle([0, 0, canvas_w, 40], fill=(20, 22, 30, 255))
    draw.text(
        (16, 11),
        f"SVG Element Inspector - {svg_path.name}  (true rendered 0..100 viewBox coordinates)",
        fill=(236, 238, 245, 255),
        font=font_hdr,
    )

    # Subtle 10x10 grid inside art box
    draw.rectangle([art_x, art_y, art_x + art_size, art_y + art_size], fill=(43, 45, 56, 255), outline=(75, 80, 100, 255))
    for step in range(10, 100, 10):
        gx = art_x + int(round((step / 100.0) * art_size))
        gy = art_y + int(round((step / 100.0) * art_size))
        draw.line([(gx, art_y), (gx, art_y + art_size)], fill=(58, 62, 78, 255), width=1)
        draw.line([(art_x, gy), (art_x + art_size, gy)], fill=(58, 62, 78, 255), width=1)
        draw.text((gx + 2, art_y + 2), str(step), fill=(135, 142, 165, 255), font=font_sm)
        draw.text((art_x + 3, gy + 2), str(step), fill=(135, 142, 165, 255), font=font_sm)

    with tempfile.TemporaryDirectory(prefix="stapler_svg_inspect_") as tmp:
        rendered_png = Path(tmp) / "art.png"
        render_svg_to_png(svg_path, rendered_png, art_size, art_size)
        art_img = Image.open(rendered_png).convert("RGBA")
        sheet.alpha_composite(art_img, (art_x, art_y))

    min_x, min_y, vb_w, vb_h = vb

    def to_px(vx: float, vy: float) -> Tuple[int, int]:
        px = art_x + int(round(((vx - min_x) / vb_w) * art_size))
        py = art_y + int(round(((vy - min_y) / vb_h) * art_size))
        return px, py

    # Split callouts into left and right columns sorted vertically by center Y
    left_items: List[Tuple[float, float, ElementInfo]] = []
    right_items: List[Tuple[float, float, ElementInfo]] = []
    center_x = min_x + vb_w * 0.5

    for item in leaves:
        if item.bbox is None:
            continue
        x0, y0, x1, y1 = item.bbox
        cx, cy = (x0 + x1) * 0.5, (y0 + y1) * 0.5
        bx0, by0 = to_px(x0, y0)
        bx1, by1 = to_px(x1, y1)
        ov_draw.rectangle([bx0, by0, bx1, by1], outline=(110, 210, 255, 85), width=1)

        if cx <= center_x:
            left_items.append((cy, cx, item))
        else:
            right_items.append((cy, cx, item))

    left_items.sort(key=lambda t: (t[0], t[1]))
    right_items.sort(key=lambda t: (t[0], t[1]))

    def draw_column(items: List[Tuple[float, float, ElementInfo]], side: str) -> None:
        if not items:
            return
        n = len(items)
        top_slot = 58
        bot_slot = canvas_h - 28
        row_h = min(22, max(14, (bot_slot - top_slot) // max(1, n)))
        total_span = row_h * n
        start_y = max(top_slot, art_y + (art_size - total_span) // 2)

        for idx, (cy, cx, info) in enumerate(items):
            ly = start_y + idx * row_h + row_h // 2
            ax, ay = to_px(cx, cy)
            swatch = _parse_hex_rgb(info.fill)
            line_col = (120, 215, 255, 155) if "ZERO-AREA(no-stroke)" not in info.flags else (255, 110, 95, 220)

            label_txt = f"#{info.z_index:02d} {info.eid}"
            if info.label:
                label_txt += f" [{info.label[:10]}]"
            label_txt += f" ({int(round(cx))},{int(round(cy))})"

            if side == "left":
                lx_end = art_x - 14
                ov_draw.line([(lx_end, ly), (ax, ay)], fill=line_col, width=1)
                ov_draw.ellipse([ax - 2, ay - 2, ax + 2, ay + 2], fill=(255, 215, 90, 230))
                if swatch:
                    ov_draw.rectangle([12, ly - 6, 22, ly + 4], fill=(*swatch, 255), outline=(220, 220, 230, 200))
                ov_draw.text((28, ly - 7), label_txt[:34], fill=(230, 234, 245, 255), font=font_sm)
            else:
                lx_start = art_x + art_size + 14
                ov_draw.line([(ax, ay), (lx_start, ly)], fill=line_col, width=1)
                ov_draw.ellipse([ax - 2, ay - 2, ax + 2, ay + 2], fill=(255, 215, 90, 230))
                if swatch:
                    ov_draw.rectangle([lx_start + 4, ly - 6, lx_start + 14, ly + 4], fill=(*swatch, 255), outline=(220, 220, 230, 200))
                ov_draw.text((lx_start + 20, ly - 7), label_txt[:34], fill=(230, 234, 245, 255), font=font_sm)

    draw_column(left_items, "left")
    draw_column(right_items, "right")

    sheet.alpha_composite(overlay)
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out_path, format="PNG")
    except OSError:
        out_path = Path(tempfile.gettempdir()) / "stapler-svg-previews" / out_path.name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out_path, format="PNG")
    return out_path


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect true rendered 0..100 coordinates of every SVG element and output an annotated callout PNG."
    )
    parser.add_argument("svg", type=Path, help="Input .svg file.")
    parser.add_argument("--out", type=Path, default=None, help="Output callout PNG path (default: .cache/svg-previews/<stem>_inspect.png).")
    parser.add_argument("--no-image", action="store_true", help="Print coordinate table only without rendering callout PNG.")
    args = parser.parse_args(argv)

    svg_path = args.svg.resolve()
    if not svg_path.is_file():
        print(f"[FAIL] SVG file not found: {svg_path}", file=sys.stderr)
        return 1

    root = ET.parse(svg_path).getroot()
    vb = parse_viewbox(root)
    if vb is None:
        print(f"[FAIL] Missing or invalid viewBox in {svg_path}", file=sys.stderr)
        return 1

    bboxes = query_svg_bboxes(svg_path)
    leaves, groups = collect_elements(root, bboxes, vb)

    out_path = args.out.resolve() if args.out else preview_output_path(svg_path.stem, "_inspect.png")
    if not args.no_image:
        out_path = render_annotated_map(svg_path, vb, leaves, out_path)
        print(f"Inspect Callout PNG: {out_path}")

    print(f"SVG: {svg_path.name}  viewBox=({vb[0]:g} {vb[1]:g} {vb[2]:g} {vb[3]:g})  visual elements={len(leaves)}")
    if groups:
        print("\nGroups (<g>) & Joint Pivot Hints:")
        for gid, glabel, gbox in groups:
            lbl = f" [{glabel}]" if glabel and glabel != gid else ""
            if gbox is not None:
                gx0, gy0, gx1, gy1 = gbox
                gcx = (gx0 + gx1) * 0.5
                print(
                    f"  - {gid}{lbl}: x=[{gx0:.1f}..{gx1:.1f}] y=[{gy0:.1f}..{gy1:.1f}] "
                    f"| top-pivot=({gcx:.1f},{gy0 + 0.1 * (gy1 - gy0):.1f}) bottom-pivot=({gcx:.1f},{gy1 - 0.08 * (gy1 - gy0):.1f})"
                )
            else:
                print(f"  - {gid}{lbl}: (empty)")

    print("\nVisual Elements (Painter's Order: #01 = back -> front):")
    print("  #Z  ID             Tag      Fill      True X [x0..x1]   True Y [y0..y1]   Center     Group / Notes")
    for info in leaves:
        if info.bbox is not None:
            x0, y0, x1, y1 = info.bbox
            cx, cy = (x0 + x1) * 0.5, (y0 + y1) * 0.5
            xr = f"[{x0:5.1f}..{x1:5.1f}]"
            yr = f"[{y0:5.1f}..{y1:5.1f}]"
            ctr = f"({cx:4.1f},{cy:4.1f})"
        else:
            xr, yr, ctr = "     (none)   ", "     (none)   ", "  (none)   "
        notes = [info.group_path]
        if info.label:
            notes.append(f"label='{info.label}'")
        notes.extend(info.flags)
        print(
            f"  #{info.z_index:02d} {info.eid:<14} {info.tag:<8} {info.fill:<9} {xr}   {yr}   {ctr}  {' | '.join(notes)}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
