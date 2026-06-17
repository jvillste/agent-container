# agent container

Command line tools for running the pi coding agent in a docker
container.

# installation

Run build.sh to build the container image.
# a cli to run the pi coding agent in a docker container



Run build.sh to build the container.

Run deploy.sh to create a symbolic link to ~/bin/agent-container.

Run agent-container to get list of commands.

Each container is identified by the name of the directory where the
container is started. The commands target the container corresponding
to the current directory.
