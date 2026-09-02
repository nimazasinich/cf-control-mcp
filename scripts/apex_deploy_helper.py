#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQ_DIR = ROOT / "requests" / "apex-deploy"
RESULT_DIR = ROOT / "results" / "apex-deploy"
STATE_DIR = ROOT / "state" / "apex-artifact-keys"


def select_pending() -> int:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    for p in sorted(REQ_DIR.glob("*.json")):
        if (RESULT_DIR / p.name).exists():
            continue
        d = json.loads(p.read_text())
        if d.get("project") != "APEX":
            raise SystemExit(f"{p}: project must be APEX")
        if d.get("request_id") != p.stem:
            raise SystemExit(f"{p}: filename/request_id mismatch")
        if d.get("confirm_deploy") is not True:
            raise SystemExit(f"{p}: confirm_deploy must be true")
        sha = str(d.get("artifact_sha256", "")).lower()
        worker = str(d.get("worker_name", "apex-cp28-staging"))
        if not re.fullmatch(r"[a-f0-9]{64}", sha):
            raise SystemExit(f"{p}: invalid artifact_sha256")
        if not re.fullmatch(r"[a-z0-9-]{1,63}", worker):
            raise SystemExit(f"{p}: invalid worker_name")
        if not d.get("artifact_key_id") or not d.get("artifact_url_ciphertext_b64"):
            raise SystemExit(f"{p}: encrypted artifact transport fields required")
        print(f"file={p.as_posix()}")
        print(f"request_id={d['request_id']}")
        print(f"artifact_key_id={d['artifact_key_id']}")
        print(f"artifact_sha256={sha}")
        print(f"worker_name={worker}")
        return 0
    raise SystemExit("no pending deployment request")


def decrypt_url(req_path: str, out_path: str) -> int:
    token = os.environ.get("MCP_AUTH_TOKEN", "")
    if not token:
        raise SystemExit("MCP_AUTH_TOKEN is required")
    req = json.loads(Path(req_path).read_text())
    state_path = STATE_DIR / f"{req['artifact_key_id']}.json"
    state = json.loads(state_path.read_text())
    iv = bytes.fromhex(state["private_key_iv_hex"])
    cipher = base64.b64decode(state["private_key_enc_b64"])
    mac_key = hashlib.sha256(("apex-artifact-mac:" + token).encode()).digest()
    expected_mac = state["private_key_hmac_sha256"]
    actual_mac = hmac.new(mac_key, iv + cipher, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_mac, actual_mac):
        raise SystemExit("encrypted private-key integrity check failed")
    enc_key = hashlib.sha256(("apex-artifact-enc:" + token).encode()).hexdigest()

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        enc = td / "private.enc"
        private = td / "private.pem"
        url_enc = td / "url.enc"
        url_txt = td / "url.txt"
        enc.write_bytes(cipher)
        url_enc.write_bytes(base64.b64decode(req["artifact_url_ciphertext_b64"]))
        subprocess.run([
            "openssl", "enc", "-d", "-aes-256-cbc",
            "-K", enc_key,
            "-iv", iv.hex(),
            "-in", str(enc),
            "-out", str(private),
        ], check=True)
        subprocess.run([
            "openssl", "pkeyutl", "-decrypt",
            "-inkey", str(private),
            "-in", str(url_enc),
            "-pkeyopt", "rsa_padding_mode:oaep",
            "-pkeyopt", "rsa_oaep_md:sha256",
            "-pkeyopt", "rsa_mgf1_md:sha256",
            "-out", str(url_txt),
        ], check=True)
        url = url_txt.read_text().strip()
        if not url.startswith("https://"):
            raise SystemExit("decrypted artifact URL must be HTTPS")
        Path(out_path).write_text(url)
    return 0


def safe_extract(zip_path: str, dest: str) -> int:
    root = Path(dest).resolve()
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            target = (root / info.filename).resolve()
            if target != root and root not in target.parents:
                raise SystemExit(f"unsafe zip path: {info.filename}")
        zf.extractall(root)
    print(f"file_count={sum(1 for p in root.rglob('*') if p.is_file())}")
    return 0


def prepare_harness(root_dir: str, worker_name: str) -> int:
    root = Path(root_dir).resolve()
    if not re.fullmatch(r"[a-z0-9-]{1,63}", worker_name):
        raise SystemExit("invalid worker_name")
    (root / ".cloudflare").mkdir(exist_ok=True)
    (root / "Dockerfile.cloudflare").write_text(
        "FROM node:22-bookworm\n"
        "WORKDIR /app\n"
        "COPY . .\n"
        "RUN npm ci && npm run build && npm prune --omit=dev\n"
        "ENV NODE_ENV=production\n"
        "ENV PORT=8080\n"
        "ENV HOST=0.0.0.0\n"
        "ENV APEX_SERVE_DIST=1\n"
        "ENV APEX_DEPLOYMENT_PROFILE=production\n"
        "EXPOSE 8080\n"
        "CMD [\"npm\",\"start\"]\n"
    )
    (root / ".dockerignore").write_text("node_modules\n_release\n.git\n")
    (root / ".cloudflare" / "apex-worker.ts").write_text(
        "import { Container } from '@cloudflare/containers';\n\n"
        "export class ApexContainer extends Container {\n"
        "  defaultPort = 8080;\n"
        "  sleepAfter = '30m';\n"
        "  envVars = {\n"
        "    NODE_ENV: 'production',\n"
        "    PORT: '8080',\n"
        "    HOST: '0.0.0.0',\n"
        "    APEX_SERVE_DIST: '1',\n"
        "    APEX_DEPLOYMENT_PROFILE: 'production',\n"
        "  };\n"
        "}\n\n"
        "export default {\n"
        "  async fetch(request: Request, env: any): Promise<Response> {\n"
        "    const container = env.APEX_CONTAINER.getByName('apex-cp28-primary');\n"
        "    return container.fetch(request);\n"
        "  },\n"
        "};\n"
    )
    config = {
        "name": worker_name,
        "main": ".cloudflare/apex-worker.ts",
        "compatibility_date": "2026-09-02",
        "containers": [{
            "max_instances": 1,
            "instance_type": "basic",
            "class_name": "ApexContainer",
            "image": "./Dockerfile.cloudflare",
            "image_build_context": ".",
        }],
        "durable_objects": {"bindings": [{"name": "APEX_CONTAINER", "class_name": "ApexContainer"}]},
        "migrations": [{"tag": "v1", "new_sqlite_classes": ["ApexContainer"]}],
    }
    (root / "wrangler.apex.jsonc").write_text(json.dumps(config, indent=2) + "\n")
    return 0


def write_result(req_path: str) -> int:
    req = json.loads(Path(req_path).read_text())
    RESULT_DIR.mkdir(parents=True, exist_ok=True)

    def to_int(name: str):
        v = os.environ.get(name, "")
        return int(v) if v.isdigit() else None

    steps = {
        "artifact_download": to_int("ARTIFACT_EXIT"),
        "source_verify_build": to_int("BUILD_EXIT"),
        "container_harness": to_int("HARNESS_EXIT"),
        "account_resolution": to_int("ACCOUNT_EXIT"),
        "cloudflare_deploy": to_int("CLOUDFLARE_EXIT"),
        "live_probe": to_int("LIVE_EXIT"),
    }
    ok = all(v == 0 for v in steps.values())
    result = {
        "project": "APEX",
        "request_id": req["request_id"],
        "ok": ok,
        "executed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "artifact": {
            "name": req.get("artifact_name"),
            "sha256": req.get("artifact_sha256"),
            "provenance": req.get("artifact_provenance"),
        },
        "worker_name": req.get("worker_name", "apex-cp28-staging"),
        "live_url": os.environ.get("LIVE_URL") or None,
        "live_http_status": to_int("LIVE_HTTP"),
        "extracted_file_count": to_int("FILE_COUNT"),
        "steps": steps,
        "security": {
            "deployment_profile": "production",
            "operator_token_configured": False,
            "mutating_api_without_operator_token": "fail-closed",
            "autonomous_live_execution": "not enabled by deployment pipeline",
        },
    }
    (RESULT_DIR / f"{req['request_id']}.json").write_text(json.dumps(result, indent=2) + "\n")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("select")
    d = sp.add_parser("decrypt-url")
    d.add_argument("request")
    d.add_argument("output")
    e = sp.add_parser("extract")
    e.add_argument("zip")
    e.add_argument("dest")
    h = sp.add_parser("prepare-harness")
    h.add_argument("root")
    h.add_argument("worker_name")
    r = sp.add_parser("write-result")
    r.add_argument("request")
    args = ap.parse_args()
    if args.cmd == "select":
        return select_pending()
    if args.cmd == "decrypt-url":
        return decrypt_url(args.request, args.output)
    if args.cmd == "extract":
        return safe_extract(args.zip, args.dest)
    if args.cmd == "prepare-harness":
        return prepare_harness(args.root, args.worker_name)
    if args.cmd == "write-result":
        return write_result(args.request)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
