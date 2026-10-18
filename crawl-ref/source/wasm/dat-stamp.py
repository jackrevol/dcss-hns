#!/usr/bin/env python3
"""A portable data mtime stamp for Linux and macOS build hosts."""
from pathlib import Path

print(max(int(p.stat().st_mtime)
          for root in (Path("dat"), Path("../docs"))
          for p in root.rglob("*") if p.is_file()))
