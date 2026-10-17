#!/bin/sh
# Bind-mounted ./data folders are created by Docker as root: hand them to the app user, then drop root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
