#!/usr/bin/env bash
# Post-deploy smoke test for undersurface.me
# Verifies the live site and API endpoints are up and routing correctly.
set -euo pipefail

BASE_URL="https://undersurface.me"
PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke testing $BASE_URL ..."
echo

# 1. Homepage returns 200
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL")
if [ "$STATUS" = "200" ]; then
  check "Homepage returns 200" "ok"
else
  check "Homepage returns 200" "got $STATUS"
fi

# 2. Homepage contains expected markers
BODY=$(curl -s "$BASE_URL")
if echo "$BODY" | grep -q '<script'; then
  check "Homepage contains script tags" "ok"
else
  check "Homepage contains script tags" "no <script found in response"
fi

if echo "$BODY" | grep -q 'UnderSurface\|undersurface\|root'; then
  check "Homepage contains app markers" "ok"
else
  check "Homepage contains app markers" "no app marker found"
fi

# 3. Admin API without auth returns 401/403 (not 500/404)
ADMIN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/admin")
if [ "$ADMIN_STATUS" = "401" ] || [ "$ADMIN_STATUS" = "403" ]; then
  check "Admin API rejects unauthenticated (${ADMIN_STATUS})" "ok"
else
  check "Admin API rejects unauthenticated" "expected 401/403, got $ADMIN_STATUS"
fi

# 4. Account API without auth returns 401 (not 500/404)
ACCOUNT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/account")
if [ "$ACCOUNT_STATUS" = "401" ] || [ "$ACCOUNT_STATUS" = "403" ]; then
  check "Account API rejects unauthenticated (${ACCOUNT_STATUS})" "ok"
else
  check "Account API rejects unauthenticated" "expected 401/403, got $ACCOUNT_STATUS"
fi

# Summary
echo
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
