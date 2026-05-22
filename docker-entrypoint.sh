#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  # Named volumes commonly start as root-owned; fix the runtime paths before
  # dropping privileges so SQLite can create WAL/shm files and caches.
  mkdir -p /data
  chown -R frontdoor:frontdoor /app /data
  exec gosu frontdoor "$@"
fi

exec "$@"
