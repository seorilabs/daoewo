#!/usr/bin/env python3
"""Validate exact PNG size and alpha rules from a registration asset manifest."""

import argparse
import json
import os
import struct
import sys


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def read_png(path):
    data = open(path, "rb").read()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")

    offset = len(PNG_SIGNATURE)
    width = height = color_type = None
    has_transparency_chunk = False
    while offset + 8 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        start = offset + 8
        end = start + length
        if end + 4 > len(data):
            raise ValueError("truncated PNG chunk")
        if chunk_type == b"IHDR":
            width, height, _bit_depth, color_type = struct.unpack(
                ">IIBB", data[start : start + 10]
            )
        elif chunk_type == b"tRNS":
            has_transparency_chunk = True
        elif chunk_type == b"IEND":
            break
        offset = end + 4

    if width is None or color_type is None:
        raise ValueError("missing IHDR")

    has_alpha = color_type in (4, 6) or has_transparency_chunk
    return width, height, has_alpha


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--root", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)

    root = args.root or os.path.dirname(os.path.abspath(args.manifest))
    output_directory = os.path.join(root, manifest.get("out_dir", "."))
    errors = []
    passed = []
    kind_counts = {}

    for item in manifest["items"]:
        item_id = item["id"]
        kind = item.get("kind", "")
        kind_counts[kind] = kind_counts.get(kind, 0) + 1
        path = os.path.join(output_directory, item["path"])
        if not os.path.exists(path):
            errors.append(f"{item_id}: missing file {path}")
            continue

        try:
            width, height, has_alpha = read_png(path)
        except Exception as error:  # pylint: disable=broad-except
            errors.append(f"{item_id}: {path}: {error}")
            continue

        item_errors = []
        if (width, height) != (item["width"], item["height"]):
            item_errors.append(
                f"must be {item['width']}x{item['height']}, found {width}x{height}"
            )
        if not item.get("transparent", False) and has_alpha:
            item_errors.append("must not contain alpha")

        if item_errors:
            errors.append(f"{item_id}: {path}: {', '.join(item_errors)}")
        else:
            passed.append(f"{item_id}: {path}")

    for rule in manifest.get("rules", []):
        count = kind_counts.get(rule["kind"], 0)
        if count < rule["min"]:
            errors.append(
                f"rule: kind '{rule['kind']}' needs >={rule['min']} items, found {count}"
            )

    if args.json:
        print(
            json.dumps(
                {"ok": not errors, "passed": passed, "errors": errors},
                ensure_ascii=False,
            )
        )
    else:
        for item in passed:
            print(f"OK {item}")
        for error in errors:
            print(f"FAIL {error}", file=sys.stderr)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
