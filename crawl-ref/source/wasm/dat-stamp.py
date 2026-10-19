#!/usr/bin/env python3
"""체크아웃 시각과 무관한 WASM 게임 데이터 식별자."""
import hashlib
from pathlib import Path


def data_stamp(source=Path(".")):
    digest = hashlib.sha256(b"hns-wasm-data-v2\0")
    for name, root in (("dat", source / "dat"), ("docs", source / "../docs")):
        if not root.is_dir():
            raise FileNotFoundError(root)
        for path in sorted(root.rglob("*"), key=lambda path: path.relative_to(root).as_posix()):
            relative = path.relative_to(root)
            # WASM의 --exclude-file과 일치합니다. 타일은 별도 빌드 ID로 검사합니다.
            if not path.is_file() or name == "dat" and relative.parts[0] == "tiles":
                continue
            digest.update((name + "/" + relative.as_posix()).encode("utf-8") + b"\0")
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    # 런타임은 이 값을 시각의 대소가 아닌 동등 비교로 검사합니다.
    # 48비트는 time_t·저장 캐시·JS 정수에서 정확히 표현됩니다.
    return int.from_bytes(digest.digest()[:6], "big") or 1


if __name__ == "__main__":
    print(data_stamp())
