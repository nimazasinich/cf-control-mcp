#!/usr/bin/env python3
"""Live end-to-end smoke test for cf-control-mcp execution tools.

Runs through the deployed Worker's /mcp endpoint using MCP_AUTH_TOKEN. This
intentionally exercises the real auth + JSON-RPC layer and the real upstreams:
paiza.IO for run_code/list_code_runtimes and GitHub Actions for gh_run_code/
gh_get_run_result.

No secret values are printed. Any unmet assertion exits non-zero so deploy
acceptance fails closed.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get(
    "MCP_BASE_URL",
    "https://cf-control-mcp.amin-chinisaz-edu.workers.dev",
).rstrip("/")
MCP_AUTH_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "").strip()
POLL_SECONDS = int(os.environ.get("EXEC_SMOKE_POLL_SECONDS", "5"))
POLL_TIMEOUT_SECONDS = int(os.environ.get("EXEC_SMOKE_TIMEOUT_SECONDS", "120"))


def redact(text: str) -> str:
    if MCP_AUTH_TOKEN:
        text = text.replace(MCP_AUTH_TOKEN, "<REDACTED>")
    return text


def fail(message: str) -> None:
    print(f"FAIL: {redact(message)}")
    raise SystemExit(1)


def rpc_call(request_id: int, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if not MCP_AUTH_TOKEN:
        fail("MCP_AUTH_TOKEN is not configured")

    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/mcp",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {MCP_AUTH_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "cf-control-exec-live-smoke/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        fail(f"{tool_name}: HTTP {exc.code}: {raw[:500]}")
    except Exception as exc:
        fail(f"{tool_name}: request failed: {exc}")

    if status != 200:
        fail(f"{tool_name}: expected HTTP 200, got {status}: {raw[:500]}")
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        fail(f"{tool_name}: non-JSON MCP response: {raw[:500]}")
    if not isinstance(envelope, dict):
        fail(f"{tool_name}: MCP response root is not an object")
    if envelope.get("error") is not None:
        fail(f"{tool_name}: JSON-RPC error: {json.dumps(envelope.get('error'))[:500]}")
    return envelope


def tool_result(
    request_id: int,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    expect_error: bool = False,
) -> tuple[Any, str]:
    envelope = rpc_call(request_id, tool_name, arguments)
    result = envelope.get("result")
    if not isinstance(result, dict):
        fail(f"{tool_name}: missing MCP result object")

    content = result.get("content")
    if not isinstance(content, list) or not content or not isinstance(content[0], dict):
        fail(f"{tool_name}: missing MCP text content")
    text = content[0].get("text")
    if not isinstance(text, str):
        fail(f"{tool_name}: MCP content text is not a string")

    is_error = result.get("isError") is True
    if is_error != expect_error:
        fail(
            f"{tool_name}: expected isError={str(expect_error).lower()}, "
            f"got {str(is_error).lower()}; tool_text={text[:500]!r}"
        )

    try:
        parsed: Any = json.loads(text)
    except json.JSONDecodeError:
        parsed = text
    return parsed, text


def require_run(payload: Any, label: str) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("run"), dict):
        fail(f"{label}: expected paiza.IO-compatible result.run object")
    return payload["run"]


def verify_github_exec() -> None:
    dispatch_payload, _ = tool_result(
        201,
        "gh_run_code",
        {"language": "python", "code": 'print("GH_MCP_EXEC_OK")'},
    )
    if not isinstance(dispatch_payload, dict):
        fail("gh_run_code: expected object result")
    run_key = dispatch_payload.get("run_key")
    if dispatch_payload.get("status") != "dispatched" or not isinstance(run_key, str) or not run_key:
        fail(
            "gh_run_code: expected status=dispatched and non-empty run_key; "
            f"got {json.dumps(dispatch_payload)[:400]}"
        )
    print("PASS: gh_run_code dispatched through deployed Worker")

    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    poll_id = 202
    last_status = "not_started"
    while time.monotonic() < deadline:
        poll_payload, _ = tool_result(
            poll_id,
            "gh_get_run_result",
            {"run_key": run_key},
        )
        poll_id += 1
        if not isinstance(poll_payload, dict):
            fail("gh_get_run_result: expected object result")
        last_status = str(poll_payload.get("status", ""))
        if last_status == "completed":
            conclusion = poll_payload.get("conclusion")
            log = str(poll_payload.get("log", ""))
            if conclusion != "success":
                fail(f"gh_get_run_result: completed with conclusion={conclusion!r}")
            if "GH_MCP_EXEC_OK" not in log:
                fail("gh_get_run_result: completed successfully but expected output marker was absent")
            print("PASS: gh_get_run_result completed through deployed Worker with expected log output")
            return
        if last_status not in {"not_found_yet", "queued", "in_progress", "waiting", "pending"}:
            fail(f"gh_get_run_result: unexpected status={last_status!r}")
        print(f"INFO: gh_get_run_result status={last_status}; polling again")
        time.sleep(POLL_SECONDS)

    fail(
        f"gh_get_run_result: timed out after {POLL_TIMEOUT_SECONDS}s; "
        f"last status={last_status!r}"
    )


def main() -> int:
    print("============================================================")
    print("EXEC TOOLS LIVE SMOKE — deployed Worker /mcp")
    print("============================================================")
    print(f"Target: {BASE_URL}")

    # Capability catalog published by the paiza.IO adapter.
    runtimes, _ = tool_result(101, "list_code_runtimes", {})
    if not isinstance(runtimes, list) or not any(
        isinstance(row, dict) and row.get("language") in {"python", "python3"} for row in runtimes
    ):
        fail("list_code_runtimes: no Python runtime returned by paiza.IO capability catalog")
    print(f"PASS: list_code_runtimes paiza.IO capability catalog ({len(runtimes)} runtimes)")

    # Verify the GitHub Actions execution round-trip independently from paiza.IO.
    verify_github_exec()

    # Real paiza.IO success path through the deployed Worker.
    success_payload, _ = tool_result(
        102,
        "run_code",
        {"language": "python", "code": 'print("PAIZA_MCP_EXEC_OK")'},
    )
    success_run = require_run(success_payload, "run_code success")
    if success_run.get("code") != 0 or "PAIZA_MCP_EXEC_OK" not in str(success_run.get("stdout", "")):
        fail(
            "run_code success: expected exit 0 and PAIZA_MCP_EXEC_OK in stdout; "
            f"got code={success_run.get('code')} stdout={str(success_run.get('stdout', ''))[:200]!r}"
        )
    print("PASS: run_code live paiza.IO success path")

    # Real paiza.IO non-zero exit path must be returned, not converted to tool failure.
    nonzero_payload, _ = tool_result(
        103,
        "run_code",
        {"language": "python", "code": "import sys; sys.exit(3)"},
    )
    nonzero_run = require_run(nonzero_payload, "run_code non-zero")
    if nonzero_run.get("code") != 3:
        fail(f"run_code non-zero: expected exit 3, got {nonzero_run.get('code')}")
    print("PASS: run_code live paiza.IO non-zero exit path")

    # Unsupported language is intentionally rejected locally by the paiza adapter
    # before an upstream session is created. It must surface as an MCP tool error.
    _, bad_language_text = tool_result(
        104,
        "run_code",
        {"language": "not-a-real-lang", "code": "x"},
        expect_error=True,
    )
    expected_fragment = "paiza.IO does not support language"
    if expected_fragment not in bad_language_text:
        fail(
            "run_code invalid language: expected paiza.IO unsupported-language tool error, got "
            f"{bad_language_text[:300]!r}"
        )
    print("PASS: run_code live paiza.IO invalid-language fail-closed path")

    print("FINAL: PASS — all four exec tools passed live end-to-end smoke verification")
    return 0


if __name__ == "__main__":
    sys.exit(main())
