#!/usr/bin/env python3
"""Reorganize flat Inkscape SVG elements into clean semantic <g> groups without altering coordinates."""

from __future__ import annotations

import argparse
import copy
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from svg_common import SVG_NS, local_tag, register_svg_namespaces

VISUAL_LEAF_TAGS = {"path", "rect", "ellipse", "circle", "polygon", "polyline", "line", "use", "text"}
PRESERVE_ROOT_TAGS = {"defs", "namedview", "metadata", "title", "desc"}


def _collect_indexed_elements(root: ET.Element) -> Tuple[Dict[str, Tuple[ET.Element, List[str]]], List[str]]:
    """Index every element with an `id` along with any ancestor `<g transform='...'>` chain."""
    by_id: Dict[str, Tuple[ET.Element, List[str]]] = {}
    leaf_order: List[str] = []

    def walk(node: ET.Element, tf_stack: List[str]) -> None:
        for child in list(node):
            tag = local_tag(child)
            if tag in PRESERVE_ROOT_TAGS:
                continue
            eid = child.attrib.get("id", "")
            child_tf = child.attrib.get("transform", "").strip()

            if tag == "g":
                if eid:
                    by_id[eid] = (child, list(tf_stack))
                next_stack = tf_stack + ([child_tf] if child_tf else [])
                walk(child, next_stack)
            else:
                if eid:
                    by_id[eid] = (child, list(tf_stack))
                    if tag in VISUAL_LEAF_TAGS:
                        leaf_order.append(eid)

    walk(root, [])
    return by_id, leaf_order


def _clone_with_inherited_transforms(elem: ET.Element, ancestor_transforms: List[str]) -> ET.Element:
    cloned = copy.deepcopy(elem)
    if ancestor_transforms:
        own_tf = cloned.attrib.get("transform", "").strip()
        combined = " ".join(ancestor_transforms + ([own_tf] if own_tf else []))
        cloned.attrib["transform"] = combined
    return cloned


def rig_svg(svg_path: Path, rig_cfg: dict, out_path: Path, strict: bool = False) -> Tuple[int, List[str]]:
    """Group elements according to `rig_cfg` and write clean semantic SVG to `out_path`.

    Returns `(grouped_count, unassigned_leaf_ids)`.
    """
    register_svg_namespaces()
    tree = ET.parse(svg_path)
    root = tree.getroot()

    by_id, leaf_order = _collect_indexed_elements(root)
    drop_ids: Set[str] = set(rig_cfg.get("drop", []))
    rename_map: Dict[str, str] = dict(rig_cfg.get("rename", {}))
    root_group_id: str = str(rig_cfg.get("rootId", "character_root"))

    raw_groups = rig_cfg.get("groups", {})
    ordered_groups: List[Tuple[str, List[str]]] = []
    if isinstance(raw_groups, dict):
        for gname, id_list in raw_groups.items():
            ordered_groups.append((str(gname), [str(x) for x in id_list]))
    elif isinstance(raw_groups, list):
        for entry in raw_groups:
            ordered_groups.append((str(entry[0]), [str(x) for x in entry[1]]))
    else:
        raise ValueError("'groups' in rig JSON must be an object or array of [groupName, [ids...]].")

    # Build fresh root preserving header children (<namedview>, <defs>, <metadata>)
    preserved_children = [copy.deepcopy(c) for c in list(root) if local_tag(c) in PRESERVE_ROOT_TAGS]
    for c in list(root):
        root.remove(c)
    for c in preserved_children:
        root.append(c)

    char_root = ET.SubElement(root, f"{{{SVG_NS}}}g", {"id": root_group_id})

    assigned_leaves: Set[str] = set()
    grouped_count = 0

    def mark_subtree_leaves(el: ET.Element) -> None:
        for sub in el.iter():
            sid = sub.attrib.get("id", "")
            if sid and local_tag(sub) in VISUAL_LEAF_TAGS:
                assigned_leaves.add(sid)

    for gname, member_ids in ordered_groups:
        resolved_elems: List[ET.Element] = []
        for mid in member_ids:
            if mid in drop_ids:
                continue
            if mid not in by_id:
                raise KeyError(f"Element ID '{mid}' (in group '{gname}') was not found in '{svg_path.name}'.")
            orig_el, anc_tfs = by_id[mid]
            mark_subtree_leaves(orig_el)
            cloned = _clone_with_inherited_transforms(orig_el, anc_tfs)
            if mid in rename_map:
                cloned.attrib["id"] = rename_map[mid]
            resolved_elems.append(cloned)
            grouped_count += 1

        # Special case: single path for cutout_border sits directly as id="cutout_border" under character_root
        if gname == "cutout_border" and len(resolved_elems) == 1 and local_tag(resolved_elems[0]) != "g":
            border_el = resolved_elems[0]
            border_el.attrib["id"] = "cutout_border"
            char_root.append(border_el)
            continue

        group_el = ET.SubElement(char_root, f"{{{SVG_NS}}}g", {"id": gname})
        for rel in resolved_elems:
            group_el.append(rel)

    unassigned = [lid for lid in leaf_order if lid not in assigned_leaves and lid not in drop_ids]
    if unassigned:
        if strict:
            raise RuntimeError(f"Unassigned visual leaf elements in '{svg_path.name}': {', '.join(unassigned)}")
        extra_g = ET.SubElement(char_root, f"{{{SVG_NS}}}g", {"id": "unassigned"})
        for lid in unassigned:
            orig_el, anc_tfs = by_id[lid]
            extra_g.append(_clone_with_inherited_transforms(orig_el, anc_tfs))

    ET.indent(tree, space="  ")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_path, encoding="utf-8", xml_declaration=True)
    return grouped_count, unassigned


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Group flat Inkscape SVG elements into semantic <g id='...'> groups using a JSON map."
    )
    parser.add_argument("svg", type=Path, help="Input .svg file.")
    parser.add_argument("--map", dest="map_json", type=Path, required=True, help="Path to rig mapping .json file.")
    parser.add_argument("--out", type=Path, default=None, help="Output .svg path (defaults to modifying input in-place).")
    parser.add_argument("--strict", action="store_true", help="Fail if any visual element is left unassigned.")
    args = parser.parse_args(argv)

    svg_path = args.svg.resolve()
    if not svg_path.is_file():
        print(f"[FAIL] SVG file not found: {svg_path}", file=sys.stderr)
        return 1

    map_path = args.map_json.resolve()
    if not map_path.is_file():
        print(f"[FAIL] Rig map JSON not found: {map_path}", file=sys.stderr)
        return 1

    rig_cfg = json.loads(map_path.read_text(encoding="utf-8"))
    out_path = args.out.resolve() if args.out else svg_path

    grouped_count, unassigned = rig_svg(svg_path, rig_cfg, out_path, strict=args.strict)
    print(f"Rigged SVG written: {out_path}  ({grouped_count} elements organized)")
    if unassigned:
        print(f"  [WARN] Unassigned elements placed in <g id='unassigned'>: {', '.join(unassigned)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
