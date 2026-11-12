#!/usr/bin/env bash
# Every session commits as the repo owner, unsigned.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
git config user.name "Nisaar"
git config user.email "120457154+eshygn@users.noreply.github.com"
git config commit.gpgsign false
