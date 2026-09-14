# OmniRoute Edge production result

Verified from GitHub Actions deploy + fresh read-only public probe.

- Exact source archive SHA256: `db08798a4e24ac2c3199a098c5f2a353d84b74be8a1e80581e1bac81a234274d`
- Worker: `omniroute-edge`
- Worker URL: `https://omniroute-edge.amin-chinisaz-edu.workers.dev`
- Deployed Worker Version ID: `6daef2e7-a9c1-43cc-8b87-bd454fa355c7`
- D1 binding: `omniroute-edge-db`
- Routing authority: `omniroute`
- `OMNIROUTE_ORIGIN`: empty
- Inference classification: `BLOCKED / NOT CONFIGURED`

Fresh public verification:

- `/`: HTTP 200
- `/signin`: HTTP 200
- `/dashboard-hub.png`: HTTP 200
- `/api/health`: HTTP 200 with `{ "status": "ok" }`
- `/api/auth/status`: HTTP 200; unauthenticated; bootstrap still required at probe time
- `/api/auth/session`: HTTP 401 `AUTH_REQUIRED`
- `/api/v2/system/status`: HTTP 401 `AUTH_REQUIRED`
- `/v1/models` without credential: HTTP 401 `invalid_api_key`

The initial immediate post-deploy smoke saw a transient `/api/auth/session` 200 and therefore the deployment workflow run itself concluded failure. A later cache-busted, cookie-free probe reproduced the source contract correctly and a hardened assertion probe completed successfully. No additional production redeploy was performed after that successful verification.

Known separate incident: an earlier mis-targeted workflow invocation redeployed `cf-control-mcp` instead of `omniroute-edge`; the target-pinning gate was then added before the successful OmniRoute deployment. This record does not classify that earlier incident as PASS.
