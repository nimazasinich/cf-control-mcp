#!/usr/bin/env python3
"""Build a clean, reproducible source checkpoint ZIP and SHA256 manifest.

This packages the working source tree without Git metadata, dependency folders,
compiled test output, caches, or nested ZIP artifacts. It intentionally does
not mutate source files; SHA256SUMS.txt is generated inside the staging copy.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

EXCLUDED_DIRS = {
    ".git",
    ".npm-cache",
    "node_modules",
    "build-test",
    "build-test-verify",
    "__pycache__",
    ".pytest_cache",
}
EXCLUDED_NAMES = {".DS_Store", ".env", "fix-cf-aig-token.bat", "SHA256SUMS.txt"}
EXCLUDED_PREFIXES = {".env."}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".zip"}


def included(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    if any(part in EXCLUDED_DIRS for part in rel.parts):
        return False
    if path.name in EXCLUDED_NAMES:
        return False
    if any(path.name.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    return path.is_file()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build(source: Path, output: Path, root_name: str) -> tuple[int, str]:
    source = source.resolve()
    output = output.resolve()
    with tempfile.TemporaryDirectory(prefix="cf-control-mcp-package-") as td:
        stage_root = Path(td) / root_name
        stage_root.mkdir(parents=True)
        files = sorted((p for p in source.rglob("*") if included(p, source)), key=lambda p: p.as_posix())
        for src in files:
            rel = src.relative_to(source)
            dst = stage_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

        manifest_lines = []
        staged_files = sorted((p for p in stage_root.rglob("*") if p.is_file()), key=lambda p: p.relative_to(stage_root).as_posix())
        for path in staged_files:
            rel = path.relative_to(stage_root).as_posix()
            manifest_lines.append(f"{sha256(path)}  {rel}")
        (stage_root / "SHA256SUMS.txt").write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")

        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            output.unlink()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for path in sorted(stage_root.rglob("*"), key=lambda p: p.as_posix()):
                if path.is_file():
                    arc = Path(root_name) / path.relative_to(stage_root)
                    zf.write(path, arc.as_posix())
        return len(staged_files) + 1, sha256(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=".")
    parser.add_argument("--output", required=True)
    parser.add_argument("--root-name", default="cf-control-mcp-hardening-checkpoint")
    args = parser.parse_args()
    count, digest = build(Path(args.source), Path(args.output), args.root_name)
    print(f"packaged_files={count}")
    print(f"zip_sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
