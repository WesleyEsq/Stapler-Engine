"""Shared utilities for Stapler Engine SVG authoring and asset-pipeline tools."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional, Tuple

SVG_NS = "http://www.w3.org/2000/svg"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"
SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
XLINK_NS = "http://www.w3.org/1999/xlink"

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REF_CANDIDATES = (
    REPO_ROOT / "games/paper-expressions/public/assets/sprites/unua.svg",
    REPO_ROOT / "Unua.svg",
)
DEFAULT_PREVIEW_DIR = REPO_ROOT / ".cache" / "svg-previews"


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


def require_binary(name: str, install_hint: str = "") -> str:
    """Locate a required system binary or raise a clear error."""
    path = shutil.which(name)
    if not path:
        hint = f" ({install_hint})" if install_hint else ""
        raise RuntimeError(f"Required CLI tool '{name}' was not found in PATH{hint}.")
    return path


def default_reference_svg() -> Optional[Path]:
    """Return the workspace's default Unua style anchor SVG if present."""
    for candidate in DEFAULT_REF_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


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
