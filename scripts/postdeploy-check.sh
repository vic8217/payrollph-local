#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/postdeploy-check.sh <base-url>"
  echo "Example: bash scripts/postdeploy-check.sh https://payroll.example.com"
  exit 1
fi

base_url="${1%/}"

echo "== PayrollPH post-deploy checks =="
echo "Target: ${base_url}"

check() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$url")"
  if [[ "$code" == "$expected" ]]; then
    echo "[OK] ${label}: ${code}"
  else
    echo "[WARN] ${label}: got ${code}, expected ${expected}"
  fi
}

check "Landing page" "${base_url}/landing" "200"
check "Root page" "${base_url}/" "200"
check "Auth me (unauth expected)" "${base_url}/api/auth/me" "401"

echo "Checking register endpoint (method guard)..."
register_code="$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/api/auth/register")"
if [[ "${register_code}" == "405" || "${register_code}" == "400" ]]; then
  echo "[OK] Register endpoint reachable: ${register_code}"
else
  echo "[WARN] Register endpoint unexpected response: ${register_code}"
fi

echo
echo "Manual checks to complete in browser:"
echo "1) Login page loads at /landing"
echo "2) Register a user (pending approval)"
echo "3) Login as super admin"
echo "4) Approve pending user in /user-management"
echo "5) Confirm approved user can sign in"
