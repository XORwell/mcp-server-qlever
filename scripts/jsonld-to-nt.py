#!/usr/bin/env python3
"""Convert JSON-LD (GND authority format) to N-Triples via streaming.

Reads gzipped or plain JSON-LD from stdin/file, emits N-Triples to stdout.
Handles the nested array structure [[ {...}, {...}, ... ]] used by DNB/GND dumps.

Data source (CC0): https://data.dnb.de/opendata/
  GND Werk: https://data.dnb.de/opendata/authorities-gnd-werk_lds_20260217.jsonld.gz

Usage:
  curl -o gnd-werk.jsonld.gz https://data.dnb.de/opendata/authorities-gnd-werk_lds_20260217.jsonld.gz
  python3 jsonld-to-nt.py --input gnd-werk.jsonld.gz --limit 50000 > sample.nt

Requires: pip install ijson
"""

import argparse
import gzip
import json
import re
import sys
from typing import TextIO

try:
    import ijson
except ImportError:
    print(
        "error: jsonld-to-nt.py requires the 'ijson' package for streaming JSON parsing.\n"
        "Install it with one of:\n"
        "  pip install ijson\n"
        "  python3 -m pip install ijson",
        file=sys.stderr,
    )
    sys.exit(1)


def escape_nt(s: str) -> str:
    """Escape a string for N-Triples literal."""
    return (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def format_value(val: dict) -> str | None:
    """Convert a JSON-LD value to N-Triples object."""
    if "@id" in val:
        uri = val["@id"]
        if uri.startswith("_:"):
            return uri  # blank node
        return f"<{uri}>"
    if "@value" in val:
        escaped = escape_nt(str(val["@value"]))
        if "@language" in val:
            return f'"{escaped}"@{val["@language"]}'
        if "@type" in val:
            return f'"{escaped}"^^<{val["@type"]}>'
        return f'"{escaped}"'
    return None


def convert_object(obj: dict, out: TextIO) -> int:
    """Convert one JSON-LD object to N-Triples lines. Returns triple count."""
    subject_id = obj.get("@id")
    if not subject_id:
        return 0

    if subject_id.startswith("_:"):
        subject = subject_id
    else:
        subject = f"<{subject_id}>"

    count = 0

    # Handle @type
    types = obj.get("@type", [])
    if isinstance(types, str):
        types = [types]
    for t in types:
        out.write(f"{subject} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <{t}> .\n")
        count += 1

    # Handle all other properties
    for pred, values in obj.items():
        if pred.startswith("@"):
            continue
        if not isinstance(values, list):
            values = [values]
        for val in values:
            if isinstance(val, dict):
                formatted = format_value(val)
                if formatted:
                    out.write(f"{subject} <{pred}> {formatted} .\n")
                    count += 1

    return count


def main():
    parser = argparse.ArgumentParser(description="Convert JSON-LD to N-Triples")
    parser.add_argument("--input", "-i", help="Input file (gzipped or plain JSON-LD)")
    parser.add_argument("--limit", "-l", type=int, default=0, help="Max objects to convert (0=all)")
    parser.add_argument("--stats", action="store_true", help="Print stats to stderr")
    args = parser.parse_args()

    if args.input:
        if args.input.endswith(".gz"):
            stream = gzip.open(args.input, "rb")
        else:
            stream = open(args.input, "rb")
    else:
        stream = sys.stdin.buffer

    obj_count = 0
    triple_count = 0
    out = sys.stdout

    try:
        for obj in ijson.items(stream, "item.item"):
            triples = convert_object(obj, out)
            triple_count += triples
            obj_count += 1

            if args.stats and obj_count % 100000 == 0:
                print(f"  {obj_count:,} objects, {triple_count:,} triples...", file=sys.stderr)

            if args.limit and obj_count >= args.limit:
                break
    finally:
        if args.input:
            stream.close()

    if args.stats:
        print(f"Done: {obj_count:,} objects, {triple_count:,} triples", file=sys.stderr)


if __name__ == "__main__":
    main()
