ln -sf "$(cd "$(dirname "$0")" && pwd)/agent-container" ~/bin/agent-container

if [ ! -f "$HOME/.config/agent-container/configuration.edn" ]; then
  mkdir -p "$HOME/.config/agent-container"
  cp "resources/empty-configuration.edn" "$HOME/.config/agent-container/configuration.edn"
fi

echo "Deployment ready."
