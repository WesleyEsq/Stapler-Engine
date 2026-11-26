#!/usr/bin/env python3
"""Render a 4-panel diagnostic preview PNG and run engine-contract lint checks on an SVG."""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from svg_common import (
    DEFAULT_PREVIEW_DIR,
    INKSCAPE_NS,
    XLINK_NS,
    default_reference_svg,
    infer_sheet_grid,
    local_tag,
    parse_grid_spec,
    parse_viewbox,
    preview_output_path,
    render_svg_to_png,
)

# Visual palette for diagnostic canvas
BG_DARK = (43, 45, 56, 255)        # #2b2d38
BG_PAPER = (232, 226, 213, 255)    # #e8e2d5 (warm paper floor)
BG_HEADER = (26, 28, 36, 255)      # #1a1c24
DIVIDER = (70, 74, 92, 255)
TEXT_LIGHT = (236, 238, 245, 255)
TEXT_MUTED = (165, 172, 194, 255)
GRID_LINE = (62, 66, 82, 255)
GRID_MAJOR = (82, 88, 110, 255)
GUIDE_UNUA = (130, 145, 190, 115)
GUIDE_FLOOR = (69, 227, 193, 220)  # #45e3c1
GUIDE_CENTER = (255, 196, 92, 110)
SHADOW_INK = (29, 31, 38, 255)
BBOX_COLOR = (235, 95, 75, 230)

# Unua anatomical reference bands in 0..100 viewBox
UNUA_HEAD_TOP_Y = 20.0
UNUA_CHIN_Y = 52.0
UNUA_SKIRT_BOTTOM_Y = 79.0
UNUA_FLOOR_Y = 96.0


@dataclass
class LintReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    infos: List[str] = field(default_factory=list)
    bbox_svg: Optional[Tuple[float, float, float, float]] = None
    opaque_ratio: float = 0.0
    semi_transparent_ratio: float = 0.0
    groups: List[str] = field(default_factory=list)
    has_cutout_border: bool = False

    @property
    def status(self) -> str:
        if self.errors:
            return "FAIL"
        if self.warnings:
            return "WARN"
        return "PASS"


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


def _parse_style_dict(style: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in style.split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip().lower()] = v.strip().lower()
    return out


def lint_svg_xml(svg_path: Path, cols: int, rows: int) -> Tuple[ET.Element, Tuple[float, float, float, float], LintReport]:
    report = LintReport()
    try:
        tree = ET.parse(svg_path)
    except ET.ParseError as exc:
        report.errors.append(f"Invalid XML: {exc}")
        raise RuntimeError(f"Failed to parse XML '{svg_path}': {exc}") from exc

    root = tree.getroot()
    if local_tag(root) != "svg":
        report.errors.append(f"Root tag is <{local_tag(root)}>, expected <svg>.")

    vb = parse_viewbox(root)
    if vb is None:
        report.errors.append("Missing or invalid 'viewBox' attribute (expected '0 0 100 100').")
        vb = (0.0, 0.0, 100.0 * cols, 100.0 * rows)
    else:
        min_x, min_y, w, h = vb
        expected_w, expected_h = 100.0 * cols, 100.0 * rows
        if abs(min_x) > 0.01 or abs(min_y) > 0.01:
            report.warnings.append(f"viewBox origin is ({min_x:g}, {min_y:g}); prefer (0, 0).")
        if abs(w - expected_w) > 0.5 or abs(h - expected_h) > 0.5:
            report.warnings.append(
                f"viewBox size is {w:g}x{h:g}; expected {expected_w:g}x{expected_h:g} for {cols}x{rows} grid."
            )

    has_f9_backing = False
    partial_opacity_ids: List[str] = []
    unbaked_lpe_ids: List[str] = []
    has_filters = False
    has_external_refs = False
    generic_group_re = re.compile(r"^(layer\d*|g\d+|svg\d*)$", re.IGNORECASE)

    for elem in root.iter():
        tag = local_tag(elem)
        eid = elem.attrib.get("id", "")
        style = _parse_style_dict(elem.attrib.get("style", ""))
        fill = (elem.attrib.get("fill") or style.get("fill") or "").lower()

        if eid == "cutout_border":
            report.has_cutout_border = True
        if fill in ("#f9f9f9", "#fafafa", "#ffffff", "white") and tag in ("path", "polygon", "rect", "ellipse"):
            has_f9_backing = True

        if tag == "g" and eid and not generic_group_re.match(eid):
            report.groups.append(eid)

        if tag == "filter":
            has_filters = True
        if tag == "image":
            has_external_refs = True

        for attr_key in ("href", f"{{{XLINK_NS}}}href"):
            href = elem.attrib.get(attr_key, "")
            if href and not href.startswith("#"):
                has_external_refs = True

        if f"{{{INKSCAPE_NS}}}path-effect" in elem.attrib and tag == "path" and not elem.attrib.get("d"):
            unbaked_lpe_ids.append(eid or "<path>")

        for op_key in ("opacity", "fill-opacity"):
            raw_op = elem.attrib.get(op_key) or style.get(op_key)
            if raw_op is not None:
                try:
                    val = float(raw_op)
                    if 0.0 < val < 0.99:
                        partial_opacity_ids.append(f"{eid or tag}({op_key}={val:g})")
                except ValueError:
                    pass

    if not report.has_cutout_border:
        if has_f9_backing:
            report.infos.append("Light paper backing detected, but no element has id='cutout_border' (ok for hand-authored SVGs).")
        else:
            report.warnings.append("No id='cutout_border' (or #f9f9f9 sticker backing) found. Run 'npm run svg:border' to generate one.")

    if not report.groups:
        report.infos.append("No named semantic <g id='...'> groups detected (recommended: head, face, torso, legs, arm_left, arm_right).")
    else:
        report.infos.append(f"Semantic groups ({len(report.groups)}): {', '.join(report.groups[:12])}")

    if unbaked_lpe_ids:
        report.errors.append(f"Unbaked Inkscape path-effect without 'd' path on: {', '.join(unbaked_lpe_ids[:5])}")
    if has_filters:
        report.warnings.append("SVG contains <filter> elements; avoid blurs/drop-shadows that conflict with Three.js alphaTest=0.5.")
    if has_external_refs:
        report.errors.append("SVG contains <image> or external href references; sprites must be self-contained vector shapes.")
    if partial_opacity_ids:
        report.warnings.append(
            f"Semi-transparent elements detected ({', '.join(partial_opacity_ids[:4])}); outer edges must stay opaque for alphaTest=0.5."
        )

    return root, vb, report


def analyze_alpha(
    img: Image.Image,
    vb: Tuple[float, float, float, float],
    cols: int,
    rows: int,
    report: LintReport,
) -> Optional[Tuple[int, int, int, int]]:
    """Compute alphaTest=0.5 bounding box in both pixels and SVG units."""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    # Binary mask matching Three.js alphaTest = 0.5 (>= 128)
    hard_mask = alpha.point(lambda a: 255 if a >= 128 else 0)
    bbox_px = hard_mask.getbbox()

    hist = alpha.histogram()
    total_px = max(1, rgba.width * rgba.height)
    opaque_px = sum(hist[128:])
    semi_px = sum(hist[1:128])
    report.opaque_ratio = opaque_px / total_px
    report.semi_transparent_ratio = semi_px / total_px

    if bbox_px is None:
        report.errors.append("Rendered SVG is completely transparent (zero pixels with alpha >= 128).")
        return None

    min_x, min_y, vb_w, vb_h = vb
    px0, py0, px1, py1 = bbox_px
    sx0 = min_x + (px0 / rgba.width) * vb_w
    sy0 = min_y + (py0 / rgba.height) * vb_h
    sx1 = min_x + (px1 / rgba.width) * vb_w
    sy1 = min_y + (py1 / rgba.height) * vb_h
    report.bbox_svg = (sx0, sy0, sx1, sy1)

    if cols == 1 and rows == 1:
        if sx0 < 1.0 or sx1 > min_x + vb_w - 1.0 or sy0 < 1.0 or sy1 > min_y + vb_h - 0.5:
            report.warnings.append(
                f"Artwork approaches/clips viewBox edge: bbox x=[{sx0:.1f}, {sx1:.1f}], y=[{sy0:.1f}, {sy1:.1f}]."
            )
        if sy1 < 92.0:
            report.warnings.append(
                f"Bottom edge sits at y={sy1:.1f} (expected ~95.5..97.5 for grounded character sprites)."
            )
        elif sy1 > 99.2:
            report.warnings.append(
                f"Bottom edge sits at y={sy1:.1f} (risk of bottom clipping against y=100)."
            )
        report.infos.append(
            f"Alpha bbox (SVG units): x=[{sx0:.1f}..{sx1:.1f}] (w={sx1 - sx0:.1f}), "
            f"y=[{sy0:.1f}..{sy1:.1f}] (h={sy1 - sy0:.1f}), opaque={report.opaque_ratio * 100:.1f}%."
        )
    else:
        cell_w_px = rgba.width / cols
        cell_h_px = rgba.height / rows
        empty_cells: List[str] = []
        cell_bottoms: List[str] = []
        for r in range(rows):
            for c in range(cols):
                crop = hard_mask.crop(
                    (
                        int(round(c * cell_w_px)),
                        int(round(r * cell_h_px)),
                        int(round((c + 1) * cell_w_px)),
                        int(round((r + 1) * cell_h_px)),
                    )
                )
                cb = crop.getbbox()
                if cb is None:
                    empty_cells.append(f"r{r}c{c}")
                else:
                    local_y1 = (cb[3] / max(1.0, crop.height)) * (vb_h / rows)
                    cell_bottoms.append(f"r{r}c{c}:y={local_y1:.1f}")
        if empty_cells:
            report.warnings.append(f"Empty spritesheet cells: {', '.join(empty_cells)}")
        report.infos.append(f"Spritesheet {cols}x{rows} cell bottoms: {', '.join(cell_bottoms[:8])}")

    if report.semi_transparent_ratio > 0.03:
        report.warnings.append(
            f"High semi-transparent pixel ratio ({report.semi_transparent_ratio * 100:.1f}% with 0 < alpha < 128); check for soft blurs or opacity < 1."
        )

    return bbox_px


def _draw_dashed_hline(draw: ImageDraw.ImageDraw, x0: int, x1: int, y: int, color: Tuple[int, int, int, int], dash: int = 8, gap: int = 6) -> None:
    x = x0
    while x < x1:
        draw.line([(x, y), (min(x1, x + dash), y)], fill=color, width=1)
        x += dash + gap


def _draw_dashed_vline(draw: ImageDraw.ImageDraw, x: int, y0: int, y1: int, color: Tuple[int, int, int, int], dash: int = 8, gap: int = 6) -> None:
    y = y0
    while y < y1:
        draw.line([(x, y), (x, min(y1, y + dash))], fill=color, width=1)
        y += dash + gap


def _fit_contain(img: Image.Image, box_w: int, box_h: int) -> Tuple[Image.Image, int, int, float]:
    scale = min(box_w / img.width, box_h / img.height)
    tw = max(1, int(round(img.width * scale)))
    th = max(1, int(round(img.height * scale)))
    resized = img.resize((tw, th), Image.Resampling.LANCZOS)
    ox = (box_w - tw) // 2
    oy = (box_h - th) // 2
    return resized, ox, oy, scale


def _build_panel_grid(
    target_img: Image.Image,
    vb: Tuple[float, float, float, float],
    cols: int,
    rows: int,
    size: int,
    font_sm: ImageFont.ImageFont,
) -> Image.Image:
    panel = Image.new("RGBA", (size, size), BG_DARK)
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(panel)
    fg_draw = ImageDraw.Draw(overlay)

    fitted, ox, oy, _ = _fit_contain(target_img, size, size)
    draw_w, draw_h = fitted.size

    if cols == 1 and rows == 1:
        # 10x10 coordinate grid across the fitted canvas
        for step in range(0, 101, 10):
            gx = ox + int(round((step / 100.0) * draw_w))
            gy = oy + int(round((step / 100.0) * draw_h))
            col_line = GRID_MAJOR if step % 50 == 0 else GRID_LINE
            bg_draw.line([(gx, oy), (gx, oy + draw_h)], fill=col_line, width=1)
            bg_draw.line([(ox, gy), (ox + draw_w, gy)], fill=col_line, width=1)

        panel.alpha_composite(fitted, (ox, oy))

        # Foreground guides (translucent so sprite colors stay accurate)
        cx = ox + int(round(0.50 * draw_w))
        _draw_dashed_vline(fg_draw, cx, oy, oy + draw_h, GUIDE_CENTER)

        for y_val, label in (
            (UNUA_HEAD_TOP_Y, "head 20"),
            (UNUA_CHIN_Y, "chin 52"),
            (UNUA_SKIRT_BOTTOM_Y, "hip 79"),
        ):
            gy = oy + int(round((y_val / 100.0) * draw_h))
            _draw_dashed_hline(fg_draw, ox, ox + draw_w, gy, GUIDE_UNUA)
            fg_draw.text((ox + draw_w - 58, gy - 12), label, fill=(180, 195, 235, 195), font=font_sm)

        # Prominent floor baseline y=96
        floor_y = oy + int(round((UNUA_FLOOR_Y / 100.0) * draw_h))
        fg_draw.line([(ox, floor_y), (ox + draw_w, floor_y)], fill=GUIDE_FLOOR, width=2)
        fg_draw.text((ox + draw_w - 64, floor_y - 14), "floor 96", fill=GUIDE_FLOOR, font=font_sm)

        # Axis coordinate ticks along top and left edges
        for step in range(10, 100, 10):
            gx = ox + int(round((step / 100.0) * draw_w))
            gy = oy + int(round((step / 100.0) * draw_h))
            fg_draw.text((gx + 2, oy + 2), str(step), fill=TEXT_MUTED, font=font_sm)
            fg_draw.text((ox + 3, gy + 2), str(step), fill=TEXT_MUTED, font=font_sm)
    else:
        panel.alpha_composite(fitted, (ox, oy))
        cell_w = draw_w / cols
        cell_h = draw_h / rows
        for r in range(rows):
            for c in range(cols):
                x0 = ox + int(round(c * cell_w))
                y0 = oy + int(round(r * cell_h))
                x1 = ox + int(round((c + 1) * cell_w))
                y1 = oy + int(round((r + 1) * cell_h))
                fg_draw.rectangle([x0, y0, x1, y1], outline=(105, 195, 255, 200), width=1)
                fy = y0 + int(round(0.96 * (y1 - y0)))
                fg_draw.line([(x0, fy), (x1, fy)], fill=GUIDE_FLOOR, width=1)
                fg_draw.text((x0 + 4, y0 + 3), f"r{r}c{c}", fill=TEXT_LIGHT, font=font_sm)

    panel.alpha_composite(overlay)
    return panel


def _build_panel_compare(
    target_img: Image.Image,
    ref_img: Optional[Image.Image],
    target_name: str,
    ref_name: str,
    cols: int,
    rows: int,
    size: int,
    font_sm: ImageFont.ImageFont,
) -> Image.Image:
    panel = Image.new("RGBA", (size, size), BG_DARK)
    draw = ImageDraw.Draw(panel)

    # Extract cell (0,0) when inspecting a spritesheet so scale comparison is 1:1 with Unua
    sample = target_img
    if cols > 1 or rows > 1:
        sample = target_img.crop((0, 0, target_img.width // cols, target_img.height // rows))

    half_w = size // 2
    slot_size = half_w - 8
    top_y = (size - slot_size) // 2

    # Shared alignment guides across both slots (head top, chin, floor)
    for y_val, col in (
        (UNUA_HEAD_TOP_Y, GUIDE_UNUA),
        (UNUA_CHIN_Y, GUIDE_UNUA),
        (UNUA_SKIRT_BOTTOM_Y, GUIDE_UNUA),
    ):
        gy = top_y + int(round((y_val / 100.0) * slot_size))
        _draw_dashed_hline(draw, 4, size - 4, gy, col)

    floor_y = top_y + int(round((UNUA_FLOOR_Y / 100.0) * slot_size))
    draw.line([(4, floor_y), (size - 4, floor_y)], fill=GUIDE_FLOOR, width=2)
    draw.line([(half_w, 8), (half_w, size - 8)], fill=DIVIDER, width=1)

    t_fit, tox, toy, _ = _fit_contain(sample, slot_size, slot_size)
    panel.alpha_composite(t_fit, (4 + tox, top_y + toy))
    draw.text((10, size - 22), f"Target: {target_name[:22]}", fill=TEXT_LIGHT, font=font_sm)

    if ref_img is not None:
        r_fit, rox, roy, _ = _fit_contain(ref_img, slot_size, slot_size)
        panel.alpha_composite(r_fit, (half_w + 4 + rox, top_y + roy))
        draw.text((half_w + 10, size - 22), f"Anchor: {ref_name[:22]}", fill=TEXT_MUTED, font=font_sm)
    else:
        draw.text((half_w + 24, size // 2 - 8), "(no reference SVG)", fill=TEXT_MUTED, font=font_sm)

    return panel


def _build_panel_shadow(
    target_img: Image.Image,
    bbox_px: Optional[Tuple[int, int, int, int]],
    report: LintReport,
    size: int,
    font_sm: ImageFont.ImageFont,
) -> Image.Image:
    panel = Image.new("RGBA", (size, size), BG_PAPER)
    fitted, ox, oy, scale = _fit_contain(target_img, size, size)
    alpha = fitted.getchannel("A")
    hard_mask = alpha.point(lambda a: 255 if a >= 128 else 0)
    silhouette = Image.new("RGBA", fitted.size, SHADOW_INK)
    panel.paste(silhouette, (ox, oy), hard_mask)

    draw = ImageDraw.Draw(panel)
    if bbox_px is not None:
        px0, py0, px1, py1 = bbox_px
        rx0 = ox + int(round(px0 * scale))
        ry0 = oy + int(round(py0 * scale))
        rx1 = ox + int(round(px1 * scale))
        ry1 = oy + int(round(py1 * scale))
        draw.rectangle([rx0, ry0, rx1, ry1], outline=BBOX_COLOR, width=2)

    if report.bbox_svg is not None:
        sx0, sy0, sx1, sy1 = report.bbox_svg
        info = f"bbox x:[{sx0:.1f}..{sx1:.1f}] y:[{sy0:.1f}..{sy1:.1f}]  opaque:{report.opaque_ratio * 100:.1f}%"
        draw.rectangle([6, 6, size - 6, 24], fill=(26, 28, 36, 210))
        draw.text((12, 9), info, fill=TEXT_LIGHT, font=font_sm)

    return panel


def _build_panel_light(target_img: Image.Image, size: int) -> Image.Image:
    # Cool snow / overcast pavement checkerboard for Paper expressions' snowy equatorial setting
    panel = Image.new("RGBA", (size, size), (237, 242, 248, 255))
    draw = ImageDraw.Draw(panel)
    tile = 16
    for y in range(0, size, tile):
        for x in range(0, size, tile):
            if ((x // tile) + (y // tile)) % 2 == 1:
                draw.rectangle([x, y, x + tile - 1, y + tile - 1], fill=(219, 228, 238, 255))

    fitted, ox, oy, _ = _fit_contain(target_img, size, size)
    panel.alpha_composite(fitted, (ox, oy))
    return panel


def compose_diagnostic_sheet(
    target_img: Image.Image,
    ref_img: Optional[Image.Image],
    target_name: str,
    ref_name: str,
    vb: Tuple[float, float, float, float],
    cols: int,
    rows: int,
    bbox_px: Optional[Tuple[int, int, int, int]],
    report: LintReport,
    panel_size: int,
) -> Image.Image:
    font_hdr = _load_font(13)
    font_sm = _load_font(11)
    hdr_h = 26
    gap = 4

    p1 = _build_panel_grid(target_img, vb, cols, rows, panel_size, font_sm)
    p2 = _build_panel_compare(target_img, ref_img, target_name, ref_name, cols, rows, panel_size, font_sm)
    p3 = _build_panel_shadow(target_img, bbox_px, report, panel_size, font_sm)
    p4 = _build_panel_light(target_img, panel_size)

    cell_w = panel_size
    cell_h = hdr_h + panel_size
    total_w = cell_w * 2 + gap * 3
    total_h = cell_h * 2 + gap * 3
    sheet = Image.new("RGBA", (total_w, total_h), DIVIDER)
    draw = ImageDraw.Draw(sheet)

    panels = [
        (0, 0, f"1. Grid & Guides ({cols}x{rows}, floor y=96)", p1),
        (1, 0, "2. Scale & Style vs Anchor", p2),
        (0, 1, "3. alphaTest=0.5 Shadow Silhouette", p3),
        (1, 1, "4. Snow / Light-Surface Contrast", p4),
    ]
    for col, row, title, img in panels:
        x = gap + col * (cell_w + gap)
        y = gap + row * (cell_h + gap)
        draw.rectangle([x, y, x + cell_w - 1, y + hdr_h - 1], fill=BG_HEADER)
        draw.text((x + 10, y + 6), title, fill=TEXT_LIGHT, font=font_hdr)
        sheet.paste(img, (x, y + hdr_h))

    return sheet


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render a 4-panel diagnostic PNG and run Stapler Engine lint checks on an SVG."
    )
    parser.add_argument("svg", type=Path, help="Path to the input .svg file.")
    parser.add_argument("--out", type=Path, default=None, help="Output PNG path (default: .cache/svg-previews/<stem>_preview.png).")
    parser.add_argument("--ref", type=Path, default=None, help="Reference anchor SVG for side-by-side comparison (defaults to unua.svg).")
    parser.add_argument("--no-ref", action="store_true", help="Disable side-by-side reference anchor rendering.")
    parser.add_argument("--size", type=int, default=512, help="Per-panel resolution in pixels (default: 512).")
    parser.add_argument("--sheet", type=str, default=None, help="Spritesheet grid '<cols>x<rows>' (auto-inferred from viewBox if omitted).")
    parser.add_argument("--strict", action="store_true", help="Exit with code 1 on warnings as well as errors.")
    args = parser.parse_args(argv)

    svg_path = args.svg.resolve()
    if not svg_path.is_file():
        print(f"[FAIL] SVG file not found: {svg_path}", file=sys.stderr)
        return 1

    # Peek viewBox to determine cols/rows before full lint
    try:
        peek_root = ET.parse(svg_path).getroot()
        peek_vb = parse_viewbox(peek_root)
    except ET.ParseError as exc:
        print(f"[FAIL] XML parse error in {svg_path}: {exc}", file=sys.stderr)
        return 1

    if args.sheet:
        cols, rows = parse_grid_spec(args.sheet)
    elif peek_vb is not None:
        cols, rows = infer_sheet_grid(peek_vb)
    else:
        cols, rows = 1, 1

    _, vb, report = lint_svg_xml(svg_path, cols, rows)

    ref_path: Optional[Path] = None
    if not args.no_ref:
        ref_path = args.ref.resolve() if args.ref else default_reference_svg(exclude=svg_path)
        if ref_path is not None and not ref_path.is_file():
            report.warnings.append(f"Reference SVG not found: {ref_path}")
            ref_path = None

    out_path = args.out.resolve() if args.out else preview_output_path(svg_path.stem, "_preview.png")

    # Compute raster resolution preserving viewBox aspect ratio (capped around panel_size * max(cols, rows))
    vb_w, vb_h = vb[2], vb[3]
    base_res = max(args.size, 512)
    if vb_w >= vb_h:
        render_w = min(2048, base_res * cols)
        render_h = max(1, int(round(render_w * (vb_h / vb_w))))
    else:
        render_h = min(2048, base_res * rows)
        render_w = max(1, int(round(render_h * (vb_w / vb_h))))

    with tempfile.TemporaryDirectory(prefix="stapler_svg_preview_") as tmp:
        tmp_dir = Path(tmp)
        target_png = tmp_dir / "target.png"
        render_svg_to_png(svg_path, target_png, render_w, render_h)
        target_img = Image.open(target_png).convert("RGBA")

        ref_img: Optional[Image.Image] = None
        if ref_path is not None:
            ref_png = tmp_dir / "ref.png"
            render_svg_to_png(ref_path, ref_png, args.size, args.size)
            ref_img = Image.open(ref_png).convert("RGBA")

        bbox_px = analyze_alpha(target_img, vb, cols, rows, report)
        sheet = compose_diagnostic_sheet(
            target_img=target_img,
            ref_img=ref_img,
            target_name=svg_path.name,
            ref_name=ref_path.name if ref_path else "",
            vb=vb,
            cols=cols,
            rows=rows,
            bbox_px=bbox_px,
            report=report,
            panel_size=args.size,
        )
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            sheet.save(out_path, format="PNG")
        except OSError:
            out_path = Path(tempfile.gettempdir()) / "stapler-svg-previews" / out_path.name
            out_path.parent.mkdir(parents=True, exist_ok=True)
            sheet.save(out_path, format="PNG")

    print(f"SVG Preview: {out_path}")
    print(f"Lint Status: {report.status}  ({svg_path.name}, viewBox={vb[0]:g} {vb[1]:g} {vb[2]:g} {vb[3]:g}, grid={cols}x{rows})")
    for msg in report.errors:
        print(f"  [ERROR] {msg}")
    for msg in report.warnings:
        print(f"  [WARN]  {msg}")
    for msg in report.infos:
        print(f"  [INFO]  {msg}")

    if report.errors:
        return 1
    if args.strict and report.warnings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
