@echo off
setlocal
cd /d "%~dp0"

echo [1/8] Restoring exact dependencies...
call npm ci
if errorlevel 1 goto :fail

echo [2/8] TypeScript compile check...
call npm run lint
if errorlevel 1 goto :fail

echo [3/8] Vitest suite...
call npm test
if errorlevel 1 goto :fail

echo [4/8] Production Vite build...
call npm run build
if errorlevel 1 goto :fail

echo [5/8] Dependency-free contract tests...
call npm run test:node
if errorlevel 1 goto :fail

echo [6/8] Verifying both approved local databases...
call npm run verify:data
if errorlevel 1 goto :fail

echo [7/8] Static safety and import integrity (PC data bundle mode)...
set "ALLOW_LOCAL_DATA_BUNDLE=1"
call npm run verify:safety
set "SAFETY_EXIT=%ERRORLEVEL%"
set "ALLOW_LOCAL_DATA_BUNDLE="
if not "%SAFETY_EXIT%"=="0" goto :fail

echo [8/8] Regenerating package manifest...
call npm run manifest
if errorlevel 1 goto :fail

echo.
echo VERIFY-AND-BUILD PASS
exit /b 0

:fail
echo.
echo VERIFY-AND-BUILD FAIL - see the command output above.
exit /b 1
