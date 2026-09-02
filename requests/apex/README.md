# APEX Cloudflare bridge

This directory is the command queue used by ChatGPT through the GitHub connector.
The APEX source repository is not modified by this bridge.

Create one immutable request file per operation:

`requests/apex/<request_id>.json`

Example read request (save with a `.json.example` suffix while documenting; only real `.json` files execute):

```json
{
  "project": "APEX",
  "request_id": "apex-20260902-list-workers",
  "method": "GET",
  "path": "/accounts/{account_id}/workers/scripts",
  "reason": "Inspect the Workers currently available for APEX"
}
```

Example write request:

```json
{
  "project": "APEX",
  "request_id": "apex-20260902-example-write",
  "method": "POST",
  "path": "/accounts/{account_id}/some/cloudflare/api/path",
  "reason": "Explicit APEX infrastructure change requested by the owner",
  "confirm_destructive": true,
  "body": {}
}
```

Rules:

- The filename stem must exactly match `request_id`.
- `project` must be exactly `APEX`.
- `path` is a Cloudflare API v4 path, never a full URL.
- `{account_id}` is resolved from the authenticated Cloudflare account in Actions.
- `GET` is read-only. `POST`, `PUT`, `PATCH`, and `DELETE` require `confirm_destructive: true`.
- Credentials come only from GitHub Actions secrets. Never put a token in a request.
- Results are written to `results/apex/<request_id>.json` with secret-like fields redacted.
- A result file makes a request idempotent at the bridge level: the same request ID is not executed again.
- Use a new request ID for every deliberate retry or changed operation.

This bridge is infrastructure control only. It does not alter APEX trading safety invariants or certify an APEX release.
