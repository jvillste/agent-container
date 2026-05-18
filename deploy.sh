rm -rf ~/agent-container-resources
cp -r resources ~/agent-container-resources

ln -s "$(cd "$(dirname "$0")" && pwd)/agent-container" ~/bin/agent-container
