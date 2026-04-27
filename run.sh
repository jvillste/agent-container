PROJECT_NAME="$(basename "$(pwd)")"
AGENT_CONTAINERS_HOME="${HOME}/agent-containers"
AGENT_CONTAINER_HOME="${AGENT_CONTAINERS_HOME}/${PROJECT_NAME}"

mkdir -p "${AGENT_CONTAINER_HOME}/pi/agent"
cp "${AGENT_CONTAINERS_HOME}/models.json" "${AGENT_CONTAINER_HOME}/pi/agent/"
if [ ! -f "${AGENT_CONTAINER_HOME}/pi/agent/settings.json" ]; then
    cp "${AGENT_CONTAINERS_HOME}/settings.json" "${AGENT_CONTAINER_HOME}/pi/agent/"
fi
cp "${AGENT_CONTAINERS_HOME}/AGENTS.md" "${AGENT_CONTAINER_HOME}/pi/agent/"

JUKKA_OPENAI_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/jukka-openai-api-key"
NITOR_OPENAI_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/nitor-openai-api-key"
JUKKA_HUGGINGFACE_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/jukka-huggingface-api-key"
JUKKA_OPENROUTER_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/jukka-openrouter-api-key"

security find-generic-password -s "jukka-openai-api-key" -a "jukka-openai-api-key" -w > "${JUKKA_OPENAI_API_KEY_FILE_NAME}"
security find-generic-password -s "nitor-openai-api-key" -a "nitor-openai-api-key" -w > "${NITOR_OPENAI_API_KEY_FILE_NAME}"
security find-generic-password -s "jukka-huggingface-api-key" -a "jukka-huggingface-api-key" -w > "${JUKKA_HUGGINGFACE_API_KEY_FILE_NAME}"
security find-generic-password -s "jukka-openrouter-api-key" -a "jukka-openrouter-api-key" -w > "${JUKKA_OPENROUTER_API_KEY_FILE_NAME}"

docker run \
      --name "${PROJECT_NAME}" \
      -it \
      --cap-drop=ALL \
      --cap-add=CHOWN \
      --cap-add=DAC_OVERRIDE \
      --cap-add=FOWNER \
      --cap-add=FSETID \
      --cap-add=SETFCAP \
      --cap-add=SETUID \
      --cap-add=SETGID \
      --security-opt=no-new-privileges \
      --memory=16g \
      --pids-limit=512 \
      -e "TAVILY_API_KEY=$(security find-generic-password -s travily-api-key -a travily-api-key -w)" \
      -v "$(pwd):/workspace" \
      -v "${AGENT_CONTAINER_HOME}/pi:/root/.pi" \
      -w /workspace \
      agent-container:latest

rm "${JUKKA_OPENAI_API_KEY_FILE_NAME}"
rm "${NITOR_OPENAI_API_KEY_FILE_NAME}"
rm "${JUKKA_HUGGINGFACE_API_KEY_FILE_NAME}"
rm "${JUKKA_OPENROUTER_API_KEY_FILE_NAME}"
