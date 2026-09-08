#!/usr/bin/env python3
"""Verify a checkpoint directory's SHA256SUMS.txt exactly."""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    manifest = root / "SHA256SUMS.txt"
    if not manifest.is_file():
        print("manifest_missing")
        return 2
    failures: list[str] = []
    listed: set[str] = set()
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, rel = line.split("  ", 1)
        listed.add(rel)
        path = root / rel
        if not path.is_file():
            failures.append(f"missing:{rel}")
        elif sha256(path) != digest:
            failures.append(f"mismatch:{rel}")
    actual = {
        p.relative_to(root).as_posix()
        for p in root.rglob("*")
        if p.is_file() and p.name != "SHA256SUMS.txt"
    }
    for rel in sorted(actual - listed):
        failures.append(f"unlisted:{rel}")
    if failures:
        print("\n".join(failures))
        return 1
    print(f"integrity_pass files={len(listed)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
