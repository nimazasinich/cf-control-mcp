#!/usr/bin/env python3
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REQUEST_DIR = ROOT / "requests" / "apex-artifact-keys"
STATE_DIR = ROOT / "state" / "apex-artifact-keys"


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    token = os.environ.get("MCP_AUTH_TOKEN", "")
    if not token:
        raise SystemExit("MCP_AUTH_TOKEN is required")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    enc_key = hashlib.sha256(("apex-artifact-enc:" + token).encode()).hexdigest()
    mac_key = hashlib.sha256(("apex-artifact-mac:" + token).encode()).digest()

    created = 0
    for req_path in sorted(REQUEST_DIR.glob("*.json")):
        req = json.loads(req_path.read_text())
        if req.get("project") != "APEX":
            raise SystemExit(f"{req_path}: project must be APEX")
        request_id = req.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            raise SystemExit(f"{req_path}: request_id required")
        if request_id != req_path.stem:
            raise SystemExit(f"{req_path}: filename/request_id mismatch")
        out_path = STATE_DIR / f"{request_id}.json"
        if out_path.exists():
            continue

        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            private_pem = td / "private.pem"
            public_pem = td / "public.pem"
            private_enc = td / "private.enc"
            run("openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:4096", "-out", str(private_pem))
            run("openssl", "pkey", "-in", str(private_pem), "-pubout", "-out", str(public_pem))
            iv = secrets.token_bytes(16)
            run(
                "openssl", "enc", "-aes-256-cbc",
                "-K", enc_key,
                "-iv", iv.hex(),
                "-in", str(private_pem),
                "-out", str(private_enc),
            )
            cipher = private_enc.read_bytes()
            mac = hmac.new(mac_key, iv + cipher, hashlib.sha256).hexdigest()
            state = {
                "project": "APEX",
                "request_id": request_id,
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "algorithm": "RSA-4096-OAEP-SHA256",
                "public_key_pem_b64": base64.b64encode(public_pem.read_bytes()).decode(),
                "private_key_cipher": "AES-256-CBC",
                "private_key_iv_hex": iv.hex(),
                "private_key_hmac_sha256": mac,
                "private_key_enc_b64": base64.b64encode(cipher).decode(),
            }
            out_path.write_text(json.dumps(state, indent=2) + "\n")
            created += 1

    print(f"created={created}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
