#!/usr/bin/env bash
# Configures npm to install Bryntum trial packages from Bryntum's private registry.
# Writes to ~/.npmrc (the user's home), never to the repository.
#
#   BRYNTUM_EMAIL=you@example.com ./scripts/bryntum-auth.sh
#
# Bryntum's trial login: username = your email with "@" replaced by "..",
# password = "trial". npm needs legacy (basic) auth for this registry.
set -euo pipefail

if [ -z "${BRYNTUM_EMAIL:-}" ]; then
  echo "BRYNTUM_EMAIL is not set. Export the email you registered a Bryntum trial with." >&2
  exit 1
fi

NPMRC="${HOME}/.npmrc"
USERNAME="${BRYNTUM_EMAIL//@/..}"
PASSWORD="trial"
AUTH="$(printf '%s:%s' "$USERNAME" "$PASSWORD" | base64 | tr -d '\n')"

touch "$NPMRC"
# Drop any previous Bryntum lines so the script is safe to re-run.
grep -v -e '^@bryntum:registry=' -e '^//npm.bryntum.com/' "$NPMRC" > "${NPMRC}.tmp" || true
mv "${NPMRC}.tmp" "$NPMRC"

{
  echo "@bryntum:registry=https://npm.bryntum.com"
  echo "//npm.bryntum.com/:_auth=${AUTH}"
  echo "//npm.bryntum.com/:always-auth=true"
} >> "$NPMRC"
chmod 600 "$NPMRC"

echo "Bryntum registry configured in ${NPMRC} for user ${USERNAME}"
