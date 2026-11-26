"""Shared utilities for Stapler Engine SVG authoring and asset-pipeline tools."""

from __future__ import annotations

import copy
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, Optional, Tuple

SVG_NS = "http://www.w3.org/2000/svg"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"
SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
XLINK_NS = "http://www.w3.org/1999/xlink"

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REF_CANDIDATES = (
    REPO_ROOT / "games/paper-expressions/public/assets/sprites/chloe.svg",
    REPO_ROOT / "Concept Art/Chloe.svg",
    REPO_ROOT / "games/paper-expressions/public/assets/sprites/unua.svg",
)

_PREVIEW_BUCKET_SUFFIXES = (
    "_walk_front_workbook",
    "_walk_back_workbook",
    "_portrait_master",
    "_walk_front",
    "_walk_back",
    "_walk_sheet",
    "_workbook",
    "_portrait",
    "_clean_ref",
    "_rigged",
    "_sheet",
    "_walk",
    "_back",
    "_front",
    "_idle",
)


def preview_output_path(stem: str, suffix: str, base_dir: Optional[Path] = None) -> Path:
    """Return an organized preview path like `.cache/svg-previews/<character>/<stem><suffix>`."""
    norm = stem.strip().lower()
    bucket = norm
    for tail in _PREVIEW_BUCKET_SUFFIXES:
        if bucket.endswith(tail) and len(bucket) > len(tail):
            bucket = bucket[: -len(tail)]
            break
    if bucket == "base_npc":
        bucket = "templates"
    root_dir = base_dir if base_dir is not None else DEFAULT_PREVIEW_DIR
    return root_dir / bucket / f"{norm}{suffix}"


def default_preview_dir() -> Path:
    """Return a writable preview output directory (.cache/svg-previews or /tmp fallback)."""
    candidate = REPO_ROOT / ".cache" / "svg-previews"
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        probe = candidate / ".write_probe"
        probe.write_text("", encoding="utf-8")
        probe.unlink()
        return candidate
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "stapler-svg-previews"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


DEFAULT_PREVIEW_DIR = default_preview_dir()


def register_svg_namespaces() -> None:
    """Register standard SVG/Inkscape XML namespaces for clean serialization."""
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("inkscape", INKSCAPE_NS)
    ET.register_namespace("sodipodi", SODIPODI_NS)
    ET.register_namespace("xlink", XLINK_NS)


def local_tag(elem: ET.Element) -> str:
    """Return an ElementTree tag without its `{namespace}` prefix."""
    tag = elem.tag
    if isinstance(tag, str) and "}" in tag:
        return tag.split("}", 1)[1]
    return str(tag)


def parse_style_dict(style: str) -> dict[str, str]:
    """Parse an inline SVG `style` attribute into a lowercase dict."""
    out: dict[str, str] = {}
    for part in style.split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip().lower()] = v.strip().lower()
    return out


def effective_prop(elem: ET.Element, prop: str) -> str:
    """Return an element's presentation attribute or inline style property (lowercased)."""
    style = parse_style_dict(elem.attrib.get("style", ""))
    return (elem.attrib.get(prop) or style.get(prop.lower()) or "").strip().lower()


def require_binary(name: str, install_hint: str = "") -> str:
    """Locate a required system binary or raise a clear error."""
    path = shutil.which(name)
    if not path:
        hint = f" ({install_hint})" if install_hint else ""
        raise RuntimeError(f"Required CLI tool '{name}' was not found in PATH{hint}.")
    return path


def default_reference_svg(exclude: Optional[Path] = None) -> Optional[Path]:
    """Return the workspace's default style anchor SVG (preferring another anchor over self)."""
    resolved_excl = exclude.resolve() if exclude is not None else None
    fallback: Optional[Path] = None
    for candidate in DEFAULT_REF_CANDIDATES:
        if candidate.is_file():
            if fallback is None:
                fallback = candidate
            if resolved_excl is None or candidate.resolve() != resolved_excl:
                return candidate
    return fallback


def parse_viewbox(root: ET.Element) -> Optional[Tuple[float, float, float, float]]:
    """Parse an SVG root's `viewBox` attribute into (min_x, min_y, width, height)."""
    raw = root.attrib.get("viewBox") or root.attrib.get("viewbox")
    if not raw:
        return None
    parts = [p for p in re.split(r"[\s,]+", raw.strip()) if p]
    if len(parts) != 4:
        return None
    try:
        vals = tuple(float(p) for p in parts)
        if vals[2] <= 0 or vals[3] <= 0:
            return None
        return vals  # type: ignore[return-value]
    except ValueError:
        return None


def parse_grid_spec(spec: str) -> Tuple[int, int]:
    """Parse a `<cols>x<rows>` string into positive integers."""
    match = re.fullmatch(r"\s*(\d+)\s*[xX×]\s*(\d+)\s*", spec)
    if not match:
        raise ValueError(f"Invalid grid spec '{spec}'. Expected format '<cols>x<rows>' (e.g. '4x2').")
    cols, rows = int(match.group(1)), int(match.group(2))
    if cols < 1 or rows < 1:
        raise ValueError(f"Grid dimensions must be >= 1, got {cols}x{rows}.")
    return cols, rows


def infer_sheet_grid(viewbox: Tuple[float, float, float, float]) -> Tuple[int, int]:
    """Infer spritesheet grid dimensions if viewBox is an integer multiple of 100x100."""
    _, _, w, h = viewbox
    cols = round(w / 100.0)
    rows = round(h / 100.0)
    if (
        cols >= 1
        and rows >= 1
        and (cols > 1 or rows > 1)
        and abs(w - cols * 100.0) < 0.5
        and abs(h - rows * 100.0) < 0.5
    ):
        return cols, rows
    return 1, 1


def _inkscape_env() -> dict[str, str]:
    """Build a clean environment for Inkscape with writable XDG directories in /tmp."""
    base = Path(tempfile.gettempdir()) / "stapler_inkscape_env"
    cfg = base / "config"
    data = base / "data"
    cache = base / "cache"
    for d in (cfg, data, cache):
        d.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["XDG_CONFIG_HOME"] = str(cfg)
    env["XDG_DATA_HOME"] = str(data)
    env["XDG_CACHE_HOME"] = str(cache)
    env["HOME"] = str(base)
    return env


def render_svg_to_png(
    svg_path: Path,
    png_path: Path,
    width: int,
    height: int,
    bg_color: Optional[str] = None,
) -> None:
    """Rasterize an SVG file to PNG using Inkscape CLI."""
    inkscape = require_binary("inkscape", "install Inkscape to rasterize SVGs")
    png_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        inkscape,
        str(svg_path),
        "--export-type=png",
        f"--export-filename={png_path}",
        "-w",
        str(width),
        "-h",
        str(height),
    ]
    if bg_color is not None:
        cmd.extend(["--export-background", bg_color, "--export-background-opacity", "1.0"])

    proc = subprocess.run(
        cmd,
        env=_inkscape_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0 or not png_path.is_file():
        raise RuntimeError(
            f"Inkscape failed to render '{svg_path}' (exit {proc.returncode}):\n{proc.stderr.strip()}"
        )


def query_svg_bboxes(svg_path: Path) -> Dict[str, Tuple[float, float, float, float]]:
    """Return true rendered viewBox bounding boxes `(x0, y0, x1, y1)` for every ID in `svg_path`.

    Uses `inkscape --query-all` calibrated against an injected viewBox reference rect so
    arbitrary transforms (`matrix(...)`, `rotate(...)`) and Inkscape `path-effect`s resolve
    accurately into viewBox units regardless of document unit (`mm`, `px`, etc.).
    """
    inkscape = require_binary("inkscape", "install Inkscape to query SVG element bounds")
    register_svg_namespaces()
    tree = ET.parse(svg_path)
    root = copy.deepcopy(tree.getroot())
    vb = parse_viewbox(root)
    if vb is None:
        raise RuntimeError(f"SVG '{svg_path}' is missing a valid viewBox attribute.")

    min_x, min_y, vb_w, vb_h = vb
    calib_id = "__stapler_vb_calib__"

    # Assign deterministic synthetic IDs to any unnamed elements just in case, though callers read existing IDs
    calib_rect = ET.Element(
        f"{{{SVG_NS}}}rect",
        {
            "id": calib_id,
            "x": str(min_x),
            "y": str(min_y),
            "width": str(vb_w),
            "height": str(vb_h),
            "fill": "#000000",
            "fill-opacity": "0.01",
            "stroke": "none",
        },
    )
    root.append(calib_rect)

    with tempfile.TemporaryDirectory(prefix="stapler_svg_query_") as tmp:
        probe_svg = Path(tmp) / "probe.svg"
        ET.ElementTree(root).write(probe_svg, encoding="utf-8", xml_declaration=True)
        proc = subprocess.run(
            [inkscape, "--query-all", str(probe_svg)],
            env=_inkscape_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"Inkscape --query-all failed on '{svg_path}' (exit {proc.returncode}):\n{proc.stderr.strip()}"
            )

    raw_boxes: Dict[str, Tuple[float, float, float, float]] = {}
    for line in proc.stdout.splitlines():
        parts = line.strip().split(",")
        if len(parts) != 5:
            continue
        eid = parts[0].strip()
        try:
            qx, qy, qw, qh = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            raw_boxes[eid] = (qx, qy, qw, qh)
        except ValueError:
            continue

    if calib_id not in raw_boxes:
        raise RuntimeError(f"Calibration rect missing from inkscape --query-all output for '{svg_path}'.")

    cx0, cy0, cw, ch = raw_boxes.pop(calib_id)
    cw = max(cw, 1e-6)
    ch = max(ch, 1e-6)

    bboxes_vb: Dict[str, Tuple[float, float, float, float]] = {}
    for eid, (qx, qy, qw, qh) in raw_boxes.items():
        x0 = min_x + ((qx - cx0) / cw) * vb_w
        y0 = min_y + ((qy - cy0) / ch) * vb_h
        x1 = x0 + (qw / cw) * vb_w
        y1 = y0 + (qh / ch) * vb_h
        bboxes_vb[eid] = (x0, y0, x1, y1)

    return bboxes_vb
