PROJECT_NAME="$(basename "$(pwd)")"
AGENT_CONTAINERS_HOME="${HOME}/agent-containers"
AGENT_CONTAINER_HOME="${AGENT_CONTAINERS_HOME}/${PROJECT_NAME}"

mkdir -p "${AGENT_CONTAINER_HOME}/pi/agent"
cp "${AGENT_CONTAINERS_HOME}/models.json" "${AGENT_CONTAINER_HOME}/pi/agent/"
cp "${AGENT_CONTAINERS_HOME}/AGENTS.md" "${AGENT_CONTAINER_HOME}/pi/agent/"

JUKKA_OPENAI_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/jukka-openai-api-key"
NITOR_OPENAI_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/nitor-openai-api-key"
JUKKA_HUGGINGFACE_API_KEY_FILE_NAME="${AGENT_CONTAINER_HOME}/pi/jukka-huggingface-api-key"

security find-generic-password -s "jukka-openai-api-key" -a "jukka-openai-api-key" -w > "${JUKKA_OPENAI_API_KEY_FILE_NAME}"
security find-generic-password -s "nitor-openai-api-key" -a "nitor-openai-api-key" -w > "${NITOR_OPENAI_API_KEY_FILE_NAME}"
security find-generic-password -s "jukka-huggingface-api-key" -a "jukka-huggingface-api-key" -w > "${JUKKA_HUGGINGFACE_API_KEY_FILE_NAME}"

docker run --rm -it \
      --cap-drop=ALL \
      --security-opt=no-new-privileges \
      --memory=16g \
      --pids-limit=512 \
      -v "$(pwd):/workspace" \
      -v "${AGENT_CONTAINER_HOME}/m2:/home/ubuntu/.m2" \
      -v "${AGENT_CONTAINER_HOME}/lein:/home/ubuntu/.lein" \
      -v "${AGENT_CONTAINER_HOME}/npm:/home/ubuntu/.npm" \
      -v "${AGENT_CONTAINER_HOME}/pi:/home/ubuntu/.pi" \
      -w /workspace \
      agent-container:latest

rm "${JUKKA_OPENAI_API_KEY_FILE_NAME}"
rm "${NITOR_OPENAI_API_KEY_FILE_NAME}"
rm "${JUKKA_HUGGINGFACE_API_KEY_FILE_NAME}"
