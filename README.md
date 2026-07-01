# agent container

This repository provides command line tools for running the Pi coding
agent in a Docker container on macOS. The advantages of doing this
are:

- Pi is run as a root and can install new software and libraries when
  it needs without making changes to the developers own machine.
- There is no need to make Pi ask the user permission to use any tools.
- Pi agents network access can be denied, except for given IP
  addresses.

WARNING: This software is at experimental state. Anything may
drastically change at any point.

# Installation

You must have Clojure and Docker installed in your system.

Run `./agent-container deploy` to create a symbolic link to
`~/bin/agent-container` and copy default configuration files to
`~/.config/agent-container`. Later on you can edit the configuration
files in `~/.config/agent-container` and they will be copied from
there to the container every time it is started. Because
`~/bin/agent-container` refers to the this source code directory, the
source code can be edited and the changes will be in effect without
new deployment.

Run `./agent-container build` to build the container image. This can
be repeated to update pi and other tools installed in the
container. `~/.config/agent-container/settings.json` is copied to the
image. This must be done at build time, since `pi install` calls later
in Dockerfile modify settings.json afterwards. Thus, if you want to
modify your default settings, you need to build the image again.

## API keys

`~/.config/agent-container/configuration.edn` lists api key
names. Each name should correspond to a password in the mac keychain
where the name is set to "name", "account" and "where" fields. When
the container starts, the corresponding api keys are exported to
corresponding environment variables, which can be referred to in
`~/.config/agent-container/models.edn`. The default configuration
refers to api key `omlx-api-key`, which is available as the
environment variable `OMLX_API_KEY` in `models.edn`.

To use the default configuration, you should start omlx server,
install Qwen3.6-27B-oQ4-mtp -model and add the omlx api key to
a keychain with "name", "account" and "where" fields containing
"omlx-api-key".

### Tavily

To use the included Tavily extension to allow pi to search the web,
add Tavily api key to your mac keychain with "name", "account" and
"where" fields set to "tavily-api-key".

# Usage

Run `agent-container` to get list of commands.

Each container is identified by the name of the directory where the
container is started. The commands target the container corresponding
to the current directory. The current directory is mounted as
`/workspace` in the container, so you can work with the same files as
pi.

# Starting Pi in the container

running `pi` in the container will load the default system promt, all
skills, extensions and the global AGENTS.md. `pi-chat` loads only
context for generic chatting.

The commands are:

## run: ([& [arguments-edn]])

  Runs the agent container. Optionally give arguments as an edn map.

  The only supported parameter is :volumes, which must be a vector of
  source and target paths to be mounted to the container when it is
  created.  Note that if the container already exists, it must be
  removed before the volumes can be mounted.

  an example:
  "{:volumes [\"./resources\" "/resources"]}"

## remove: ([])

  Removes the Docker container.

## bash: ([])

  Start bash shell in the running container.

## restrict-network: ([& allowed-addresses])

  Creates firewall rules to the running containers network namespace
  that only allow connections to the given domain port pairs. for
  example to allow access to the local omlx server, include
  host.docker.internal:8888.

  The domain IP:s are resolved on the host and the traffic is
  restricted on the IP level. The IPs are added to /etc/hosts in the
  container, so DNS queries are not needed to access the domains. If
  the domains change their IP, you will have to unrestrict, and
  restrict the network again. If other domains point to the same IPs,
  they will also be accessible from the container.

## unrestrict-network: ([])

  Remove firewall rules.

## container-name: ([])

  Prints the name of the docker container corresponding to this
  directory.

## deploy: ([])

  Creates a symlink in ~/bin/agent-contaienr pointing to the
  agent-container script in this directory and copies default
  configuration files into ~/.config. Must be run in the
  agent-container source directory.

## build: ([])

  Build the container image and copy
  ~/.config/agent-container/settings.json into it. Must be run in the
  agent-container source directory.
