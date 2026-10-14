#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  data_dir=$(realpath -m -- "${DATA_DIR:-/app/data}")
  case "$data_dir" in
    /|/app|/etc|/usr|/var|/home|/root|/proc|/sys|/dev|/run|/tmp)
      echo "DATA_DIR must be a dedicated data directory" >&2
      exit 1
      ;;
  esac
  mkdir -p -- "$data_dir"
  # Do not follow symlinks or cross filesystems while repairing a bind mount.
  find "$data_dir" -xdev \( ! -user node -o ! -group node \) -exec chown --no-dereference node:node {} +
  export DATA_DIR="$data_dir"
  exec gosu node "$@"
fi

exec "$@"
