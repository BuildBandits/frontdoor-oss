#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  # Named volumes commonly start as root-owned; fix the writable runtime path
  # before dropping privileges so SQLite can create WAL/shm files and caches.
  # Only entries with a different owner are changed (e.g. files left by a
  # `docker exec` run as root), so large caches are not rewritten on every start.
  mkdir -p /data
  find /data \( ! -user frontdoor -o ! -group frontdoor \) -exec chown frontdoor:frontdoor {} +
  exec gosu frontdoor "$@"
fi

exec "$@"
