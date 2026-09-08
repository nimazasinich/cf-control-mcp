@echo off
setlocal EnableExtensions

REM ============================================================
REM  cf-control-mcp — set CF_AIG_TOKEN Worker secret
REM  Run this from INSIDE your cf-control-mcp project folder
REM  (same folder as wrangler.jsonc). Needs Node.js + internet.
REM  DELETE THIS FILE after running it — it contains a live secret.
REM ============================================================

set "CLOUDFLARE_API_TOKEN=REDACTED_ROTATE_IMMEDIATELY"
set "CF_AIG_TOKEN_VALUE=REDACTED_ROTATE_IMMEDIATELY"

echo ==========================================
echo  Step 1: Setting CF_AIG_TOKEN worker secret
echo ==========================================
<nul set /p "=%CF_AIG_TOKEN_VALUE%" | npx wrangler secret put CF_AIG_TOKEN
if errorlevel 1 (
    echo.
    echo [FAILED] Could not set the secret. Common causes:
    echo   - this .bat is not sitting inside the cf-control-mcp project folder
    echo   - node_modules not installed yet: run "npm install" first
    echo   - CLOUDFLARE_API_TOKEN does not have "Edit Workers" permission
    pause
    exit /b 1
)

echo.
echo [OK] CF_AIG_TOKEN secret pushed to the Worker.
echo.
echo ==========================================
echo  Step 2: Verify production
echo ==========================================
if not "%CLOUDFLARE_ACCOUNT_ID%"=="" if not "%GATEWAY_AUTH_TOKEN%"=="" (
    python scripts\verify_production.py
) else (
    echo To run the full check, set these first and re-run this script:
    echo   set CLOUDFLARE_ACCOUNT_ID=your-account-id
    echo   set GATEWAY_AUTH_TOKEN=your-gateway-auth-token
    echo.
    echo Or just test it directly in your browser / Postman:
    echo   POST https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1/chat/completions
    echo   Header: Authorization: Bearer ^<your GATEWAY_AUTH_TOKEN^>
    echo   Body:   {"model":"fast","messages":[{"role":"user","content":"ping"}]}
    echo A 200 response instead of 503 means it's fixed.
)

echo.
echo ==========================================
echo  IMPORTANT
echo ==========================================
echo This file has a live Cloudflare token in it. Delete it now:
echo   del "%~f0"
echo Also rotate the tokens you pasted in chat earlier - they were exposed in plaintext.
pause
