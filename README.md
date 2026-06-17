# agent container

Command line tools for running the pi coding agent in a docker
container.

# installation

Run build.sh to build the container image.
# agent-container

This is a cli to run the pi coding agent in a docker container on in macos.

# Installation

Run `./agent-contaienr deploy` to create a symbolic link to
`~/bin/agent-container` and copy default configuration files to
`~/.config/agent-container`. Later on you can edit the configuration
files in `~/.config/agent-container` and they will be copied from there
to the container every time it is started.

Run `./agent-contaienr deploy` to build the container image. This can be repeated to
update pi and other tools installed in the
container. `~/.config/agent-container/settings.json` is copied to the
image. This must be done at build time, since `pi install` calls later
in Dockerfile modify settings.json afterwards. Thus, if you want to
modify your default settings, you need to build the image again.

Because `~/bin/agent-container` refers to the this source code
directory, the source code can be edited and the changes will be in
effect without new deployment.

`~/.config/agent-container/configuration.edn` lists api key
names. Each name should correspond to password in the mac
keychain. When the container starts, the corresponding api keys are
exported to corresponding environment variables, which can be referred
to in `~/.config/agent-container/models.edn`. The default
configuration referes to api key "omlx-api-key".

To use the default configuration, you should start omlx server,
install Qwen3.6-27B-oQ4-mtp -model and add the omlx api key to
a keychain with "name", "account" and "where" fields containing
"omlx-api-key".

## Tavily

To use the included tavily extension, add tavily api key to keychain
with "name", "account" and "where" field set to "tavily-api-key".

# Usage

Run `agent-container` to get list of commands.

Each container is identified by the name of the directory where the
container is started. The commands target the container corresponding
to the current directory.

The commands are:

run: ([& [arguments-edn]])

  Runs the agent container. Optionally give arguments as an edn map.

  The only supported parameter is :volumes, which must be a vector of
  source and target paths to be mounted to the container when it is
  created.  Note that if the container already exists, it must be
  removed before the volumes can be mounted.

  an example:
  "{:volumes [\"./resources\" "/resources"]}"

remove: ([])

  Removes the Docker container.

bash: ([])

  start bash shell in the running container

restrict-network: ([& allowed-addresses])

  Creates firewall rules to the running containers network namespace
  that only allow connections to the given domain port pairs. for
  example to allow access to the local omlx server, include
  host.docker.internal:8888

unrestrict-network: ([])

  Remove firewall rules.

container-name: ([])

  Prints the name of the docker container corresponding to this
  directory.

deploy: ([])

 Creates a symlink in ~/bin/agent-contaienr pointing to the
  agent-container script in this directory and copies default
  configuration files into ~/.config. Must be run in the
  agent-container source directory.

build: ([])

 Build the container image and copy
  ~/.config/agent-container/settings.json into it. Must be run in the
  agent-container source directory.
