#!/usr/bin/env sh
# Husky shell helper (copied inline to avoid install script running here)
if [ -z "$husky_skip_init" ]; then
  debug () {
    [ "$HUSKY_DEBUG" = "1" ] && echo "husky (debug) - $1"
  }
  readonly hook_name="$(basename -- "$0")"
  debug "starting $hook_name..."
fi
