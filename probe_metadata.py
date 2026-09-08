"""
Full verification script: Admin API authenticated flow + MCP endpoint.
"""
import urllib.request, urllib.error, json, os, sys

BASE = "https://cf-control-mcp.amin-chinisaz-edu.workers.dev"

# Load env
with open(".env") as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip().strip('"')

MCP_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")
GW_TOKEN = os.environ.get("GATEWAY_AUTH_TOKEN", "")

results = []

def check(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    results.append((name, status, detail))
    print(f"{status}: {name} — {detail}")
    return passed

def http(url, method="GET", headers=None, data=None, allow_redirects=False):
    h = {"User-Agent": "cf-control-verifier/1.0"}
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        if isinstance(data, dict):
            body = json.dumps(data).encode()
            h.setdefault("Content-Type", "application/json")
        elif isinstance(data, bytes):
            body = data
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    if not allow_redirects:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw): return None
        opener = urllib.request.build_opener(NoRedirect)
    else:
        opener = urllib.request.build_opener()
    try:
        with opener.open(req, timeout=15) as r:
            raw = r.read().decode("utf-8", errors="replace")
            return r.status, r.headers, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return e.code, e.headers, raw
    except Exception as ex:
        return 0, {}, str(ex)

print("\n=== SECTION 1: MCP Endpoint ===")

# 1a. No auth -> 401
status, hdrs, raw = http(BASE + "/mcp", method="POST", data={"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
body = json.loads(raw) if raw.startswith("{") else {}
check("MCP no-auth -> 401", status == 401, f"HTTP {status}")

# 1b. Invalid token -> 401
status, hdrs, raw = http(BASE + "/mcp", method="POST",
    headers={"Authorization": "Bearer INVALID_TOKEN_XYZ"},
    data={"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
check("MCP invalid-token -> 401", status == 401, f"HTTP {status}")

# 1c. Valid legacy token -> initialize
status, hdrs, raw = http(BASE + "/mcp", method="POST",
    headers={"Authorization": f"Bearer {MCP_TOKEN}"},
    data={"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
try:
    body = json.loads(raw)
    ok = status == 200 and body.get("result", {}).get("serverInfo", {}).get("name") == "cf-control-mcp"
    proto = body.get("result", {}).get("protocolVersion", "?")
    ver = body.get("result", {}).get("serverInfo", {}).get("version", "?")
    check("MCP owner auth -> initialize", ok, f"HTTP {status} proto={proto} ver={ver}")
except Exception as ex:
    check("MCP owner auth -> initialize", False, f"parse error: {ex}")

# 1d. tools/list with full owner scope
status, hdrs, raw = http(BASE + "/mcp", method="POST",
    headers={"Authorization": f"Bearer {MCP_TOKEN}"},
    data={"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
try:
    body = json.loads(raw)
    tools_list = body.get("result", {}).get("tools", [])
    tool_names = [t["name"] for t in tools_list]
    has_read = any(t["name"] == "cf_verify_api_token" for t in tools_list)
    has_write = any(t["name"] == "cf_deploy_worker_module" for t in tools_list)
    has_exec = any(t["name"] == "run_code" for t in tools_list)
    has_admin = any(t["name"] == "cf_api_request" for t in tools_list)
    check("MCP tools/list -> all scopes visible", has_read and has_write and has_exec and has_admin,
          f"total={len(tools_list)} read={has_read} write={has_write} exec={has_exec} admin={has_admin}")
except Exception as ex:
    check("MCP tools/list -> all scopes visible", False, str(ex))

# 1e. Safe read-only tool: cf_verify_api_token
status, hdrs, raw = http(BASE + "/mcp", method="POST",
    headers={"Authorization": f"Bearer {MCP_TOKEN}"},
    data={"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cf_verify_api_token","arguments":{}}})
try:
    body = json.loads(raw)
    result = body.get("result", {})
    is_error = result.get("isError", True)
    content = result.get("content", [{}])[0].get("text", "")
    tool_ok = status == 200 and not is_error and "status" in content.lower()
    check("MCP cf_verify_api_token (read-only) -> success", tool_ok, f"HTTP {status} isError={is_error} content_len={len(content)}")
except Exception as ex:
    check("MCP cf_verify_api_token (read-only) -> success", False, str(ex))

print("\n=== SECTION 2: Admin Auth (Login via API) ===")

# 2a. Invalid token -> 401
status, hdrs, raw = http(BASE + "/admin/login", method="POST",
    headers={"Accept": "application/json", "Origin": BASE, "Referer": BASE + "/admin/login"},
    data={"token": "INVALID_TOKEN_FOR_TEST"})
try:
    body = json.loads(raw) if raw.startswith("{") else {}
    check("Admin login invalid-token -> 401", status == 401 and not body.get("ok", True),
          f"HTTP {status} ok={body.get('ok')}")
except Exception as ex:
    check("Admin login invalid-token -> 401", False, str(ex))

# 2b. Valid token -> 200 + cookie
status, hdrs, raw = http(BASE + "/admin/login", method="POST",
    headers={"Accept": "application/json", "Origin": BASE, "Referer": BASE + "/admin/login"},
    data={"token": MCP_TOKEN})
cookie = None
try:
    body = json.loads(raw) if raw.startswith("{") else {}
    set_cookie = hdrs.get("Set-Cookie", "") if hasattr(hdrs, "get") else ""
    if not set_cookie:
        # HTTPError path won't hit here for 200, but check headers dict
        for k, v in (hdrs.items() if hasattr(hdrs, "items") else []):
            if k.lower() == "set-cookie":
                set_cookie = v
                break
    cookie = set_cookie.split(";")[0] if set_cookie else None
    ok = status == 200 and body.get("ok") is True and cookie
    check("Admin login valid-token -> 200 + cookie", ok,
          f"HTTP {status} ok={body.get('ok')} cookie={'SET' if cookie else 'MISSING'}")
except Exception as ex:
    check("Admin login valid-token -> 200 + cookie", False, str(ex))

if not cookie:
    print("BLOCKED: no admin session cookie — skipping authenticated Admin tests")
    sys.exit(0)

print(f"Session cookie obtained: {cookie[:30]}...")

print("\n=== SECTION 3: Admin Metadata Flow ===")

# 3a. Read original model metadata
status, hdrs, raw = http(BASE + "/admin/api/models", headers={"Cookie": cookie})
try:
    body = json.loads(raw)
    models = body.get("models", [])
    target = next((m for m in models if m["id"] == "gemini-3.6-flash"), None)
    if target:
        orig_dn = target.get("display_name")
        orig_desc = target.get("description")
        check("Admin /api/models loads", True, f"count={len(models)} target_found=True orig_dn={orig_dn!r}")
    else:
        orig_dn = orig_desc = None
        check("Admin /api/models loads", False, "gemini-3.6-flash not found")
except Exception as ex:
    orig_dn = orig_desc = None
    check("Admin /api/models loads", False, str(ex))

# 3b. PATCH metadata (Admin authenticated path)
status, hdrs, raw = http(BASE + "/admin/api/models/gemini-3.6-flash/metadata",
    method="PATCH",
    headers={"Cookie": cookie, "Origin": BASE, "Referer": BASE + "/admin"},
    data={"displayName": "PROBE-UI-3.6", "description": "Temporary Admin UI verification probe"})
try:
    body = json.loads(raw) if raw.startswith("{") else {}
    ok = status == 200 and body.get("ok") is True
    new_dn = body.get("model", {}).get("display_name")
    new_desc = body.get("model", {}).get("description")
    check("Admin PATCH /metadata -> 200", ok, f"HTTP {status} ok={body.get('ok')} dn={new_dn!r}")
    set_ok = new_dn == "PROBE-UI-3.6" and new_desc == "Temporary Admin UI verification probe"
    check("Admin metadata values set correctly", set_ok, f"dn={new_dn!r} desc={new_desc!r}")
except Exception as ex:
    check("Admin PATCH /metadata -> 200", False, str(ex))
    set_ok = False

# 3c. D1 readback after mutation
status, hdrs, raw = http(BASE + "/admin/api/models", headers={"Cookie": cookie})
try:
    body = json.loads(raw)
    models = body.get("models", [])
    t2 = next((m for m in models if m["id"] == "gemini-3.6-flash"), None)
    if t2:
        d1_dn = t2.get("display_name")
        d1_desc = t2.get("description")
        d1_ok = d1_dn == "PROBE-UI-3.6"
        check("D1 readback after mutation", d1_ok, f"dn={d1_dn!r} desc={d1_desc!r}")
        model_id_unchanged = t2.get("id") == "gemini-3.6-flash"
        check("Model ID immutable after metadata PATCH", model_id_unchanged, f"id={t2.get('id')!r}")
    else:
        check("D1 readback after mutation", False, "model not found")
        check("Model ID immutable", False, "model not found")
except Exception as ex:
    check("D1 readback after mutation", False, str(ex))

# 3d. Restore original
restore_data = {"displayName": orig_dn, "description": orig_desc}
status, hdrs, raw = http(BASE + "/admin/api/models/gemini-3.6-flash/metadata",
    method="PATCH",
    headers={"Cookie": cookie, "Origin": BASE, "Referer": BASE + "/admin"},
    data=restore_data)
try:
    body = json.loads(raw) if raw.startswith("{") else {}
    ok = status == 200 and body.get("ok") is True
    restored_dn = body.get("model", {}).get("display_name")
    restored_desc = body.get("model", {}).get("description")
    check("Admin PATCH restore -> 200", ok, f"HTTP {status} dn={restored_dn!r}")
    restore_correct = restored_dn == orig_dn and restored_desc == orig_desc
    check("Restored values match original", restore_correct, f"dn={restored_dn!r} orig={orig_dn!r}")
except Exception as ex:
    check("Admin PATCH restore -> 200", False, str(ex))

# 3e. Final D1 readback
status, hdrs, raw = http(BASE + "/admin/api/models", headers={"Cookie": cookie})
try:
    body = json.loads(raw)
    models = body.get("models", [])
    t3 = next((m for m in models if m["id"] == "gemini-3.6-flash"), None)
    if t3:
        final_dn = t3.get("display_name")
        final_desc = t3.get("description")
        final_ok = final_dn == orig_dn and final_desc == orig_desc
        check("D1 final readback matches original", final_ok, f"dn={final_dn!r} desc={final_desc!r}")
    else:
        check("D1 final readback", False, "model not found")
except Exception as ex:
    check("D1 final readback", False, str(ex))

print("\n=== SECTION 4: Admin API Routes ===")

for path, label in [
    ("/admin/api/overview", "overview"),
    ("/admin/api/providers", "providers"),
    ("/admin/api/routing", "routing"),
    ("/admin/api/health", "health"),
    ("/admin/api/tools", "tools"),
    ("/admin/api/settings", "settings"),
]:
    status, hdrs, raw = http(BASE + path, headers={"Cookie": cookie})
    try:
        body = json.loads(raw)
        check(f"Admin API {label} -> 200", status == 200, f"HTTP {status} keys={list(body.keys())[:5]}")
    except Exception as ex:
        check(f"Admin API {label} -> 200", False, str(ex))

# Routing specifics
status, hdrs, raw = http(BASE + "/admin/api/routing", headers={"Cookie": cookie})
try:
    body = json.loads(raw)
    rules = body.get("rules", [])
    rules_map = {r["public_alias"]: r.get("model_id") for r in rules}
    fast_target = rules_map.get("fast")
    coding_target = rules_map.get("coding")
    research_target = rules_map.get("research")
    check("Routing fast target", fast_target == "gemini-3.6-flash", f"fast -> {fast_target!r}")
    check("Routing coding target", coding_target == "gemini-3.8-flash", f"coding -> {coding_target!r}")
    check("Routing research target", research_target == "gemini-3.8-flash", f"research -> {research_target!r}")
except Exception as ex:
    check("Routing targets", False, str(ex))

print("\n=== SUMMARY ===")
pass_count = sum(1 for _, s, _ in results if s == "PASS")
fail_count = sum(1 for _, s, _ in results if s == "FAIL")
print(f"TOTAL: {len(results)} | PASS: {pass_count} | FAIL: {fail_count}")
if fail_count:
    print("FAILURES:")
    for name, status, detail in results:
        if status == "FAIL":
            print(f"  FAIL: {name} — {detail}")
