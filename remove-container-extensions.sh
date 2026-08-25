#!/bin/sh
# Remove ~/.pi/agent/extensions/ if this is an agent container.
if [ -f "$HOME/this-is-an-agent-container" ]; then
  rm -rf "$HOME/.pi/agent/extensions"
fi
