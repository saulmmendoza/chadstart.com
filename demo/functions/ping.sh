#!/usr/bin/env bash
# ping.sh — ChadStart Bash function
# Returns a simple pong response.
#
# Runtime: bash
# Trigger: GET /api/fn/ping (public)
#          cron: @hourly

set -euo pipefail

# ChadStart passes event JSON via stdin (or first arg).
# For a ping we ignore the input and return JSON on stdout.
echo '{"pong":true,"runtime":"bash","ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
