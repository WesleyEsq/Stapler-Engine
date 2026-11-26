#!/usr/bin/env python3
"""Generate a 4-frame side-by-side Inkscape walk-cycle workbook SVG from a rigged character SVG.

With `--auto-walk`, replaces the idle standing legs in each frame with clean 2-segment
kinematic walking legs (thigh + rounded knee + shin + 3/4 rounded boot), counter-swinging
arms anchored to true shoulder joints, and subtle nodding/bobbing head motion — while
keeping 100% of the hand-drawn head, hair, face, coat, and skirt untouched and editable.
"""

from __future__ import annotations

import argparse
import copy
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from svg_border import _remove_existing_border
from svg_common import (
    INKSCAPE_NS,
    SODIPODI_NS,
    SVG_NS,
    effective_prop,
    local_tag,
    parse_viewbox,
    query_svg_bboxes,
    register_svg_namespaces,
)
from svg_pack import SKIP_ROOT_TAGS, _scope_element_ids

HEAD_GROUPS = {"hair_back", "head", "face", "hair_front", "props"}
TORSO_GROUPS = {"torso"}
ARM_LEFT_GROUPS = {"arm_left", "arm_front"}
ARM_RIGHT_GROUPS = {"arm_right", "arm_back"}
LEG_GROUPS = {"leg_left", "leg_right", "legs"}

DEFAULT_FRAME_SPECS: List[Tuple[str, str, float, str]] = [
    ("frame_0", "F1 Contact (L) [low]", +0.85, "contact_a"),
    ("frame_1", "F2 Passing (R) [high]", -0.85, "passing_a"),
    ("frame_2", "F3 Contact (R) [low]", +0.85, "contact_b"),
    ("frame_3", "F4 Passing (L) [high]", -0.85, "passing_b"),
]

SIX_FRAME_SPECS: List[Tuple[str, str, float, str]] = [
    ("frame_0", "F1 Contact (L) [low]", +0.90, "contact_a"),
    ("frame_1", "F2 Passing (R) [mid]", -0.35, "passing_6_a"),
    ("frame_2", "F3 Up-Reach (R) [peak]", -1.15, "up_a"),
    ("frame_3", "F4 Contact (R) [low]", +0.90, "contact_b"),
    ("frame_4", "F5 Passing (L) [mid]", -0.35, "passing_6_b"),
    ("frame_5", "F6 Up-Reach (L) [peak]", -1.15, "up_b"),
]


def _darken_hex(hex_color: str, factor: float = 0.80) -> str:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", hex_color):
        return hex_color
    r = max(0, min(255, int(round(int(hex_color[1:3], 16) * factor))))
    g = max(0, min(255, int(round(int(hex_color[3:5], 16) * factor))))
    b = max(0, min(255, int(round(int(hex_color[5:7], 16) * factor))))
    return f"#{r:02x}{g:02x}{b:02x}"


def _detect_leg_palette(src_root: ET.Element) -> Tuple[str, str]:
    """Detect the primary leg/tights fill and boot/shoe fill from `#leg_left`/`#leg_right`."""
    leg_fill = "#6c5d53"
    boot_fill = "#333333"
    for elem in src_root.iter():
        if local_tag(elem) == "g" and elem.attrib.get("id") in ("leg_left", "leg_right"):
            children = list(elem)
            fills = [effective_prop(c, "fill") for c in children if effective_prop(c, "fill").startswith("#")]
            if len(fills) >= 2:
                boot_fill = fills[-1]
                leg_fill = fills[-2]
                break
            elif len(fills) == 1:
                leg_fill = fills[0]
    return leg_fill, boot_fill


def _segment_polygon_points(
    p0: Tuple[float, float],
    p1: Tuple[float, float],
    width: float,
    extend_start: float = 0.0,
    extend_end: float = 0.0,
) -> str:
    """Return SVG polygon points for a clean flat geometric bar of `width` from p0 to p1."""
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    length = max(1e-4, math.hypot(dx, dy))
    ux, uy = dx / length, dy / length
    # Perpendicular half-width vector
    nx, ny = -uy * (width * 0.5), ux * (width * 0.5)

    sx = p0[0] - ux * extend_start
    sy = p0[1] - uy * extend_start
    ex = p1[0] + ux * extend_end
    ey = p1[1] + uy * extend_end

    pts = [
        (sx + nx, sy + ny),
        (sx - nx, sy - ny),
        (ex - nx, ey - ny),
        (ex + nx, ey + ny),
    ]
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)


def _build_kinematic_leg(
    group_id: str,
    hip: Tuple[float, float],
    knee: Tuple[float, float],
    ankle: Tuple[float, float],
    foot_angle_deg: float,
    leg_color: str,
    boot_color: str,
    leg_width: float = 3.25,
) -> ET.Element:
    """Construct a crisp 2-segment geometric leg (thigh + knee cap + shin + 3/4 rounded boot)."""
    g = ET.Element(f"{{{SVG_NS}}}g", {"id": group_id})

    # Thigh (extends slightly above hip so it tucks cleanly under the skirt/coat hem)
    ET.SubElement(
        g,
        f"{{{SVG_NS}}}polygon",
        {
            "id": f"{group_id}_thigh",
            "fill": leg_color,
            "stroke": "none",
            "points": _segment_polygon_points(hip, knee, leg_width, extend_start=1.4, extend_end=0.1),
        },
    )
    # Rounded knee joint so bent knees never show a sharp corner notch
    ET.SubElement(
        g,
        f"{{{SVG_NS}}}circle",
        {
            "id": f"{group_id}_knee",
            "fill": leg_color,
            "stroke": "none",
            "cx": f"{knee[0]:.2f}",
            "cy": f"{knee[1]:.2f}",
            "r": f"{leg_width * 0.5:.2f}",
        },
    )
    # Shin (extends slightly into the top of the boot for a seamless ankle join)
    ET.SubElement(
        g,
        f"{{{SVG_NS}}}polygon",
        {
            "id": f"{group_id}_shin",
            "fill": leg_color,
            "stroke": "none",
            "points": _segment_polygon_points(knee, ankle, leg_width, extend_start=0.1, extend_end=0.9),
        },
    )

    # 3/4 right-facing quarter-arch rounded boot matching Chloe/Unua's boot geometry
    # Local origin (0,0) = center of ankle top; sole bottom sits at y = +5.1
    ax, ay = ankle
    boot_d = (
        "M -1.70,0.00 "
        "H 1.75 "
        "A 4.85,4.85 0 0 1 6.60,4.85 "
        "V 5.10 "
        "H -1.70 "
        "Z"
    )
    boot_tf = f"translate({ax:.2f},{ay:.2f})"
    if abs(foot_angle_deg) > 1e-3:
        boot_tf += f" rotate({foot_angle_deg:.2f})"

    ET.SubElement(
        g,
        f"{{{SVG_NS}}}path",
        {
            "id": f"{group_id}_boot",
            "fill": boot_color,
            "stroke": "none",
            "d": boot_d,
            "transform": boot_tf,
        },
    )
    return g


def _walk_frame_kinematics(pose_kind: str, stride: float = 1.0) -> dict:
    """Return 4-frame 3/4-right walk kinematics inspired by Ada's concept sheet (floor y = 95.8)."""
    s = stride
    # Contact stride poses (body dips low, wide V-stride, counter-swinging arms, slight forward nod)
    # Passing poses (body rises high over planted vertical leg, opposite leg bends at knee with lifted boot)
    if pose_kind == "contact_a":
        # Near leg FORWARD (heel strike), Far leg BACK (toe push-off on y=95.6)
        return {
            "torso_dy": +0.85 * s,
            "head_dy": +1.10 * s,
            "head_rot": +1.8 * s,
            "hair_back_dy": +0.35 * s,
            "arm_left_rot": +11.0 * s,   # Near arm swings BACK (-X)
            "arm_right_rot": -11.0 * s,  # Far arm swings FORWARD (+X)
            "far_leg": {
                "hip": (48.0, 79.6),
                "knee": (48.0 - 3.2 * s, 84.5),
                "ankle": (48.0 - 7.3 * s, 87.9),
                "foot_deg": +30.0 * s,
            },
            "near_leg": {
                "hip": (49.8, 79.6),
                "knee": (49.8 + 2.8 * s, 85.1),
                "ankle": (49.8 + 5.2 * s, 90.6),
                "foot_deg": -12.0 * s,
            },
        }

    if pose_kind == "passing_a":
        # Near leg PLANTED straight on y=95.8, Far leg BENT KNEE lifted clearly off floor
        return {
            "torso_dy": -0.85 * s,
            "head_dy": -1.10 * s,
            "head_rot": -1.4 * s,
            "hair_back_dy": -0.40 * s,
            "arm_left_rot": -2.0 * s,
            "arm_right_rot": +2.0 * s,
            "far_leg": {
                "hip": (48.0, 78.6),
                "knee": (47.3, 84.1),
                "ankle": (47.3 - 5.4 * s, 86.5),
                "foot_deg": +36.0 * s,
            },
            "near_leg": {
                "hip": (49.4, 78.6),
                "knee": (49.4, 84.7),
                "ankle": (49.2, 90.7),
                "foot_deg": 0.0,
            },
        }

    if pose_kind == "contact_b":
        # Far leg FORWARD (heel strike), Near leg BACK (toe push-off) — mirrors F1 depth!
        return {
            "torso_dy": +0.85 * s,
            "head_dy": +1.10 * s,
            "head_rot": +1.8 * s,
            "hair_back_dy": +0.35 * s,
            "arm_left_rot": -15.0 * s,   # Near arm swings FORWARD (+X)
            "arm_right_rot": +10.0 * s,  # Far arm swings BACK (-X)
            "far_leg": {
                "hip": (49.8, 79.6),
                "knee": (49.8 + 2.8 * s, 85.1),
                "ankle": (49.8 + 5.2 * s, 90.6),
                "foot_deg": -12.0 * s,
            },
            "near_leg": {
                "hip": (48.0, 79.6),
                "knee": (48.0 - 3.2 * s, 84.5),
                "ankle": (48.0 - 7.3 * s, 87.9),
                "foot_deg": +30.0 * s,
            },
        }

    if pose_kind == "passing_6_a":
        # 6-frame Passing A: Near leg planted straight, Far knee passing behind (mid-height)
        return {
            "torso_dy": -0.35 * s,
            "head_dy": -0.45 * s,
            "head_rot": -0.4 * s,
            "hair_back_dy": -0.15 * s,
            "arm_left_rot": -1.5 * s,
            "arm_right_rot": +1.5 * s,
            "far_leg": {
                "hip": (48.0, 78.9),
                "knee": (47.4, 84.3),
                "ankle": (47.4 - 5.4 * s, 86.7),
                "foot_deg": +36.0 * s,
            },
            "near_leg": {
                "hip": (49.4, 78.9),
                "knee": (49.4, 84.8),
                "ankle": (49.2, 90.7),
                "foot_deg": 0.0,
            },
        }

    if pose_kind == "up_a":
        # 6-frame Peak Up-Reach A: Near leg pushing off behind, Far leg swinging forward to step!
        return {
            "torso_dy": -1.15 * s,
            "head_dy": -1.45 * s,
            "head_rot": -1.6 * s,
            "hair_back_dy": -0.45 * s,
            "arm_left_rot": -8.5 * s,
            "arm_right_rot": +6.0 * s,
            "far_leg": {
                "hip": (49.2, 78.3),
                "knee": (49.2 + 3.8 * s, 83.4),
                "ankle": (49.2 + 5.0 * s, 88.6),
                "foot_deg": -5.0 * s,
            },
            "near_leg": {
                "hip": (49.2, 78.3),
                "knee": (49.2 - 1.2 * s, 83.9),
                "ankle": (49.2 - 3.2 * s, 89.2),
                "foot_deg": +14.0 * s,
            },
        }

    if pose_kind == "passing_6_b":
        # 6-frame Passing B: Far leg planted straight, Near knee passing in front (mid-height)
        return {
            "torso_dy": -0.35 * s,
            "head_dy": -0.45 * s,
            "head_rot": -0.4 * s,
            "hair_back_dy": -0.15 * s,
            "arm_left_rot": +1.5 * s,
            "arm_right_rot": -1.5 * s,
            "far_leg": {
                "hip": (49.6, 78.9),
                "knee": (49.6, 84.8),
                "ankle": (49.4, 90.7),
                "foot_deg": 0.0,
            },
            "near_leg": {
                "hip": (48.2, 78.9),
                "knee": (48.2 + 2.2 * s, 84.1),
                "ankle": (48.2 - 2.6 * s, 86.9),
                "foot_deg": +26.0 * s,
            },
        }

    if pose_kind == "up_b":
        # 6-frame Peak Up-Reach B: Far leg pushing off behind, Near leg swinging forward to step!
        return {
            "torso_dy": -1.15 * s,
            "head_dy": -1.45 * s,
            "head_rot": -1.6 * s,
            "hair_back_dy": -0.45 * s,
            "arm_left_rot": +6.5 * s,
            "arm_right_rot": -6.5 * s,
            "far_leg": {
                "hip": (49.2, 78.3),
                "knee": (49.2 - 1.2 * s, 83.9),
                "ankle": (49.2 - 3.2 * s, 89.2),
                "foot_deg": +14.0 * s,
            },
            "near_leg": {
                "hip": (49.2, 78.3),
                "knee": (49.2 + 3.8 * s, 83.4),
                "ankle": (49.2 + 5.0 * s, 88.6),
                "foot_deg": -5.0 * s,
            },
        }

    # passing_b: Far leg PLANTED straight on y=95.8, Near leg BENT KNEE lifted & swinging forward
    return {
        "torso_dy": -0.85 * s,
        "head_dy": -1.10 * s,
        "head_rot": -1.4 * s,
        "hair_back_dy": -0.40 * s,
        "arm_left_rot": +2.0 * s,
        "arm_right_rot": -2.0 * s,
        "far_leg": {
            "hip": (49.6, 78.6),
            "knee": (49.6, 84.7),
            "ankle": (49.4, 90.7),
            "foot_deg": 0.0,
        },
        "near_leg": {
            "hip": (48.2, 78.6),
            "knee": (48.2 + 2.4 * s, 83.9),
            "ankle": (48.2 - 2.6 * s, 86.8),
            "foot_deg": +26.0 * s,
        },
    }


def _append_stride_ghost(parent: ET.Element, x_off: float, pose_kind: str) -> None:
    """Add an ultra-faint non-exported stride guide silhouette in the locked guides layer."""
    g = ET.SubElement(
        parent,
        f"{{{SVG_NS}}}g",
        {
            "opacity": "0.18",
            "fill": "none",
            "stroke": "#7ad7f0",
            "stroke-width": "0.55",
            "stroke-dasharray": "1.6,1.2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
        },
    )
    if pose_kind.startswith("contact"):
        ET.SubElement(
            g,
            f"{{{SVG_NS}}}path",
            {
                "d": (
                    f"M {x_off + 47.0},79.0 L {x_off + 39.5},91.5 L {x_off + 36.2},94.2 "
                    f"M {x_off + 51.0},79.0 L {x_off + 57.5},92.0 L {x_off + 62.0},95.4"
                )
            },
        )
    else:
        ET.SubElement(
            g,
            f"{{{SVG_NS}}}path",
            {
                "d": (
                    f"M {x_off + 49.5},79.0 L {x_off + 49.5},95.4 "
                    f"M {x_off + 46.5},79.5 L {x_off + 45.2},87.5 L {x_off + 39.8},91.5"
                )
            },
        )


def _build_guides_layer(
    root: ET.Element,
    frame_specs: List[Tuple[str, str, float, str]],
    cell_size: float,
    include_ghosts: bool,
) -> None:
    total_w = len(frame_specs) * cell_size
    guides = ET.SubElement(
        root,
        f"{{{SVG_NS}}}g",
        {
            "id": "stapler_guides",
            f"{{{INKSCAPE_NS}}}groupmode": "layer",
            f"{{{INKSCAPE_NS}}}label": "GUIDES (locked - auto-stripped)",
            f"{{{SODIPODI_NS}}}insensitive": "true",
        },
    )

    for idx, (_, label, _, pose_kind) in enumerate(frame_specs):
        x0 = idx * cell_size
        ET.SubElement(
            guides,
            f"{{{SVG_NS}}}rect",
            {
                "x": f"{x0:g}",
                "y": "0",
                "width": f"{cell_size:g}",
                "height": f"{cell_size:g}",
                "fill": "#2d303c" if idx % 2 == 0 else "#333745",
                "stroke": "#5b637d",
                "stroke-width": "0.35",
            },
        )
        ET.SubElement(
            guides,
            f"{{{SVG_NS}}}rect",
            {
                "x": f"{x0 + 4:g}",
                "y": "4",
                "width": f"{cell_size - 8:g}",
                "height": f"{cell_size - 6:g}",
                "fill": "none",
                "stroke": "#4b526a",
                "stroke-width": "0.25",
                "stroke-dasharray": "1.5,1.5",
            },
        )
        ET.SubElement(
            guides,
            f"{{{SVG_NS}}}line",
            {
                "x1": f"{x0 + 50:g}",
                "y1": "0",
                "x2": f"{x0 + 50:g}",
                "y2": f"{cell_size:g}",
                "stroke": "#f5c26b",
                "stroke-opacity": "0.35",
                "stroke-width": "0.3",
                "stroke-dasharray": "2,2",
            },
        )
        txt = ET.SubElement(
            guides,
            f"{{{SVG_NS}}}text",
            {
                "x": f"{x0 + 50:g}",
                "y": "8.5",
                "text-anchor": "middle",
                "fill": "#d8deee",
                "font-family": "sans-serif",
                "font-size": "4.2",
            },
        )
        txt.text = label

        if include_ghosts:
            _append_stride_ghost(guides, x0, pose_kind)

    for y_val, color, width, dash in (
        (20.0, "#8fa0d4", "0.3", "2,2"),
        (52.0, "#8fa0d4", "0.3", "2,2"),
        (79.0, "#8fa0d4", "0.3", "2,2"),
        (96.0, "#45e3c1", "0.55", ""),
    ):
        attrs = {
            "x1": "0",
            "y1": f"{y_val:g}",
            "x2": f"{total_w:g}",
            "y2": f"{y_val:g}",
            "stroke": color,
            "stroke-opacity": "0.85" if y_val == 96.0 else "0.45",
            "stroke-width": width,
        }
        if dash:
            attrs["stroke-dasharray"] = dash
        ET.SubElement(guides, f"{{{SVG_NS}}}line", attrs)


def _strip_prefix(gid: str) -> str:
    if gid.startswith("f") and "_" in gid and gid[1:2].isdigit():
        return gid.split("_", 1)[1]
    return gid


def _prepend_transform(elem: ET.Element, tf: str) -> None:
    if not tf.strip():
        return
    prev = elem.attrib.get("transform", "").strip()
    elem.attrib["transform"] = f"{tf} {prev}".strip()


def _apply_auto_walk_frame(
    frame_layer: ET.Element,
    prefix: str,
    pose_kind: str,
    stride: float,
    head_motion: float,
    leg_color: str,
    boot_color: str,
    bboxes: Dict[str, Tuple[float, float, float, float]],
    back_view: bool = False,
) -> None:
    """Replace idle legs with 2-segment walking legs and apply arm swing + subtle head nod/bob."""
    kin = _walk_frame_kinematics(pose_kind, stride=stride)
    arm_left_rot = kin["arm_right_rot"] if back_view else kin["arm_left_rot"]
    arm_right_rot = kin["arm_left_rot"] if back_view else kin["arm_right_rot"]
    far_leg_color = _darken_hex(leg_color, 0.80)
    far_boot_color = _darken_hex(boot_color, 0.78)

    # Resolve true anatomical shoulder & neck pivots from the source character's bounding boxes
    head_box = bboxes.get("head")
    neck_x = ((head_box[0] + head_box[2]) * 0.5) if head_box else 49.0
    neck_y = (head_box[3] - 0.5) if head_box else 51.8

    # Inner-top shoulder corner keeps angled sleeves seamlessly attached to the coat shoulders
    arm_l_box = bboxes.get("arm_left") or bboxes.get("arm_front")
    sh_l = (arm_l_box[2] - 1.3, arm_l_box[1] + 1.2) if arm_l_box else (46.0, 54.5)

    arm_r_box = bboxes.get("arm_right") or bboxes.get("arm_back")
    sh_r = (arm_r_box[0] + 1.1, arm_r_box[1] + 1.2) if arm_r_box else (52.4, 54.5)

    # Locate the parent container holding semantic groups (character_root or frame_layer)
    group_parent = frame_layer
    for child in list(frame_layer):
        if local_tag(child) == "g" and _strip_prefix(child.attrib.get("id", "")) == "character_root":
            group_parent = child
            break

    # Replace leg_left / leg_right at the exact z-position of the first leg group (behind torso/skirt)
    first_leg_idx: Optional[int] = None
    for i, child in enumerate(list(group_parent)):
        if local_tag(child) == "g" and _strip_prefix(child.attrib.get("id", "")) in LEG_GROUPS:
            if first_leg_idx is None:
                first_leg_idx = i
            group_parent.remove(child)

    far_cfg = kin["far_leg"]
    near_cfg = kin["near_leg"]
    far_leg_el = _build_kinematic_leg(
        group_id=f"{prefix}_leg_far",
        hip=far_cfg["hip"],
        knee=far_cfg["knee"],
        ankle=far_cfg["ankle"],
        foot_angle_deg=far_cfg["foot_deg"],
        leg_color=far_leg_color,
        boot_color=far_boot_color,
    )
    near_leg_el = _build_kinematic_leg(
        group_id=f"{prefix}_leg_near",
        hip=near_cfg["hip"],
        knee=near_cfg["knee"],
        ankle=near_cfg["ankle"],
        foot_angle_deg=near_cfg["foot_deg"],
        leg_color=leg_color,
        boot_color=boot_color,
    )

    insert_at = first_leg_idx if first_leg_idx is not None else 0
    group_parent.insert(insert_at, far_leg_el)
    group_parent.insert(insert_at + 1, near_leg_el)

    # Apply upper-body bob, subtle nodding head motion, and counter-swinging arms
    torso_dy = kin["torso_dy"]
    head_dy = kin["head_dy"] * head_motion
    head_rot = kin["head_rot"] * head_motion
    hair_extra_dy = kin["hair_back_dy"] * head_motion

    for child in list(group_parent):
        if local_tag(child) != "g":
            continue
        base_id = _strip_prefix(child.attrib.get("id", ""))
        if base_id in TORSO_GROUPS:
            _prepend_transform(child, f"translate(0,{torso_dy:.3g})")
        elif base_id in HEAD_GROUPS:
            dy = head_dy + (hair_extra_dy if base_id == "hair_back" else 0.0)
            tf = f"translate(0,{dy:.3g}) rotate({head_rot:.3g},{neck_x:.2f},{neck_y:.2f})"
            _prepend_transform(child, tf)
        elif base_id in ARM_LEFT_GROUPS:
            tf = f"translate(0,{torso_dy:.3g}) rotate({arm_left_rot:.3g},{sh_l[0]:.2f},{sh_l[1]:.2f})"
            _prepend_transform(child, tf)
        elif base_id in ARM_RIGHT_GROUPS:
            tf = f"translate(0,{torso_dy:.3g}) rotate({arm_right_rot:.3g},{sh_r[0]:.2f},{sh_r[1]:.2f})"
            _prepend_transform(child, tf)


def _apply_bob_only(frame_layer: ET.Element, bob_y: float) -> None:
    if abs(bob_y) < 1e-4:
        return
    upper = HEAD_GROUPS | TORSO_GROUPS | ARM_LEFT_GROUPS | ARM_RIGHT_GROUPS
    for elem in frame_layer.iter():
        if local_tag(elem) == "g" and _strip_prefix(elem.attrib.get("id", "")) in upper:
            _prepend_transform(elem, f"translate(0,{bob_y:.3g})")


def build_walk_workbook(
    source_svg: Path,
    out_path: Path,
    frames: int = 4,
    auto_walk: bool = True,
    stride: float = 1.0,
    head_motion: float = 1.0,
    bob_amplitude: float = 1.0,
    include_ghosts: bool = True,
    cell_size: float = 100.0,
    leg_color_override: Optional[str] = None,
    boot_color_override: Optional[str] = None,
    back_view: bool = False,
) -> None:
    register_svg_namespaces()
    src_root = ET.parse(source_svg).getroot()
    vb = parse_viewbox(src_root)
    if vb is None:
        raise RuntimeError(f"Source SVG '{source_svg}' is missing a valid viewBox.")

    frame_specs = SIX_FRAME_SPECS if frames == 6 else DEFAULT_FRAME_SPECS

    bboxes = query_svg_bboxes(source_svg) if auto_walk else {}
    auto_leg_col, auto_boot_col = _detect_leg_palette(src_root)
    leg_color = leg_color_override or auto_leg_col
    boot_color = boot_color_override or auto_boot_col

    clean_src = copy.deepcopy(src_root)
    _remove_existing_border(clean_src, "cutout_border", replace_backdrop=True)

    cols = len(frame_specs)
    total_w = cols * cell_size
    total_h = cell_size

    wb_root = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "version": "1.1",
            "width": f"{total_w:g}mm",
            "height": f"{total_h:g}mm",
            "viewBox": f"0 0 {total_w:g} {total_h:g}",
            "data-stapler-workbook": "1",
            "data-cols": str(cols),
            "data-cell-size": f"{cell_size:g}",
            "data-source": source_svg.name,
        },
    )

    ET.SubElement(
        wb_root,
        f"{{{SODIPODI_NS}}}namedview",
        {
            "id": "namedview_workbook",
            "pagecolor": "#262833",
            "bordercolor": "#eeeeee",
            "borderopacity": "1",
            f"{{{INKSCAPE_NS}}}pageopacity": "0",
            f"{{{INKSCAPE_NS}}}deskcolor": "#262833",
            f"{{{INKSCAPE_NS}}}document-units": "mm",
            f"{{{INKSCAPE_NS}}}current-layer": frame_specs[0][0],
        },
    )

    defs_elem = ET.SubElement(wb_root, f"{{{SVG_NS}}}defs", {"id": "defs_workbook"})
    has_defs = False

    _build_guides_layer(wb_root, frame_specs, cell_size=cell_size, include_ghosts=include_ghosts)

    for idx, (frame_id, label, base_bob, pose_kind) in enumerate(frame_specs):
        prefix = f"f{idx}"
        frame_layer = ET.SubElement(
            wb_root,
            f"{{{SVG_NS}}}g",
            {
                "id": frame_id,
                f"{{{INKSCAPE_NS}}}groupmode": "layer",
                f"{{{INKSCAPE_NS}}}label": label,
                "transform": f"translate({idx * cell_size:g},0)",
            },
        )

        for child in list(clean_src):
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
                frame_layer.append(cloned)

        if auto_walk:
            _apply_auto_walk_frame(
                frame_layer=frame_layer,
                prefix=prefix,
                pose_kind=pose_kind,
                stride=stride,
                head_motion=head_motion,
                leg_color=leg_color,
                boot_color=boot_color,
                bboxes=bboxes,
                back_view=back_view,
            )
        else:
            _apply_bob_only(frame_layer, base_bob * bob_amplitude)

    if not has_defs:
        wb_root.remove(defs_elem)

    tree = ET.ElementTree(wb_root)
    ET.indent(tree, space="  ")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_path, encoding="utf-8", xml_declaration=True)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a 4-frame side-by-side walk-cycle workbook SVG with kinematic bent-knee legs, arm swing, and head motion."
    )
    parser.add_argument("svg", type=Path, help="Input rigged base character .svg (e.g. chloe.svg).")
    parser.add_argument("--out", type=Path, required=True, help="Output Inkscape workbook .svg path.")
    parser.add_argument("--frames", type=int, choices=[4, 6], default=6, help="Number of walk-cycle frames (4 or 6, default: 6).")
    parser.add_argument("--blank-legs", action="store_true", help="Keep idle legs untouched (bob upper body only) for fully manual Inkscape sculpting.")
    parser.add_argument("--stride", type=float, default=1.0, help="Stride & arm-swing amplitude multiplier (default: 1.0).")
    parser.add_argument("--head-motion", type=float, default=1.0, help="Head vertical bob + nod tilt multiplier (default: 1.0).")
    parser.add_argument("--leg-color", type=str, default=None, help="Override leg/tights hex color (auto-detected from source SVG by default).")
    parser.add_argument("--boot-color", type=str, default=None, help="Override boot/shoe hex color (auto-detected from source SVG by default).")
    parser.add_argument("--no-ghosts", action="store_true", help="Omit dashed stride guide silhouettes in the locked guides layer.")
    parser.add_argument("--back", action="store_true", help="Invert arm counter-swing for 3/4 back-view characters where the near arm is on the right.")
    args = parser.parse_args(argv)

    svg_path = args.svg.resolve()
    if not svg_path.is_file():
        print(f"[FAIL] Source SVG not found: {svg_path}", file=sys.stderr)
        return 1

    out_path = args.out.resolve()
    build_walk_workbook(
        source_svg=svg_path,
        out_path=out_path,
        frames=args.frames,
        auto_walk=not args.blank_legs,
        stride=args.stride,
        head_motion=args.head_motion,
        include_ghosts=not args.no_ghosts,
        leg_color_override=args.leg_color,
        boot_color_override=args.boot_color,
        back_view=args.back,
    )
    mode = "auto-walk (2-segment bent-knee legs + arm swing + head nod)" if not args.blank_legs else "blank-legs (manual Inkscape sculpting)"
    print(f"Walk workbook written ({mode}): {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
