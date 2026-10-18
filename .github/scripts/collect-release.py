"""Collect a complete platform release and hash exactly the files being uploaded."""

import hashlib
import os
from pathlib import Path
import re
import shutil
import sys


def collect(artifacts: Path, destination: Path, tag: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", tag):
        raise ValueError("Release tag must be safe to use in asset filenames")

    version = tag.removeprefix("v")
    prefix = f"dcss-hns-{version}"
    patterns = {
        "app-debug.apk": f"{prefix}-android-debug.apk",
        f"DCSS-HNS-{version}-windows-x64.zip": f"{prefix}-windows-x64.zip",
        f"DCSS-HNS-{version}-linux-x64.tar.gz": f"{prefix}-linux-x64.tar.gz",
        f"DCSS-HNS-{version}-mac-x64.zip": f"{prefix}-macos-x64.zip",
        f"DCSS-HNS-{version}-mac-arm64.zip": f"{prefix}-macos-arm64.zip",
        f"dcss-hns-{version}-source.tar.gz": f"{prefix}-source.tar.gz",
    }
    selected = []
    for pattern, name in patterns.items():
        matches = [path for path in artifacts.rglob(pattern) if path.is_file()]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {pattern}, found {len(matches)}")
        source = matches[0]
        if source.stat().st_size == 0:
            raise ValueError(f"Empty release file: {source}")
        selected.append((source, name or source.name))

    # Refuse partial input before writing anything, and refuse stale output.
    destination.mkdir(parents=True, exist_ok=False)
    checksums = []
    for source, name in sorted(selected, key=lambda item: item[1]):
        target = destination / name
        shutil.copyfile(source, target)
        with target.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        checksums.append(f"{digest}  {name}\n")
    (destination / "SHA256SUMS.txt").write_text("".join(checksums), encoding="utf-8")


if __name__ == "__main__":
    collect(Path(sys.argv[1]), Path(sys.argv[2]), os.environ["RELEASE_TAG"])
