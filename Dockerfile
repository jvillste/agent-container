FROM ubuntu:26.04
ARG HOME_DIR

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV TZ=Europe/Helsinki

# Base OS packages + Java + tools commonly needed in Clojure/CLJS projects
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    make \
    gnupg \
    rlwrap \
    unzip \
    zip \
    bash \
    python3 \
    openssh-client \
    openjdk-21-jdk \
    emacs-nox \
    curl \
    iptables \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 from NodeSource
# NodeSource documents setup_22.x for Debian/Ubuntu installs.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh \
    && bash /tmp/nodesource_setup.sh \
    && apt-get update && apt-get install -y nodejs \
    && rm -f /tmp/nodesource_setup.sh \
    && rm -rf /var/lib/apt/lists/*

# Install PI
RUN npm install -g yarn
RUN curl -fsSL https://pi.dev/install.sh | sh
COPY temp/user-settings.json /root/.pi/agent/settings.json

# Install Clojure CLI
RUN curl -L -O https://github.com/clojure/brew-install/releases/latest/download/linux-install.sh \
    && chmod +x linux-install.sh \
    && ./linux-install.sh \
    && rm -f linux-install.sh

# Install Leiningen
# Leiningen's GitHub mirror states the project is moving to Codeberg,
# but the stable script URL remains the usual installer entry point.
RUN curl -fsSL https://raw.githubusercontent.com/technomancy/leiningen/stable/bin/lein \
      -o /usr/local/bin/lein \
    && chmod +x /usr/local/bin/lein

# install babashka
RUN bash -ic 'bash < <(curl -s https://raw.githubusercontent.com/babashka/babashka/master/install)'

RUN ln -sf /usr/bin/python3 /usr/bin/python

USER root
WORKDIR /workspace

# set path
RUN echo 'export PATH="$PATH:$HOME/.local/bin"' >> /root/.bashrc
RUN echo 'export PATH="$PATH:$HOME/bin"' >> /root/.bashrc

# install pi extensions
RUN pi install npm:pi-tavily-tools
RUN pi install npm:pi-hashline-edit

# install bbin
RUN mkdir -p ~/.local/bin && curl -o- -L https://raw.githubusercontent.com/babashka/bbin/v0.2.5/bbin > ~/.local/bin/bbin && chmod +x ~/.local/bin/bbin


# install clj-paren-repair
RUN ~/.local/bin/bbin install https://github.com/bhauman/clojure-mcp-light.git --tag v0.2.2 --as clj-paren-repair --main-opts '["-m" "clojure-mcp-light.paren-repair"]'
RUN bash -lic 'clj-paren-repair -h'

# Warm up lein so the standalone jar gets downloaded during image build
RUN lein version || true

RUN git config --global user.name "Jukka Villstedt"
RUN git config --global user.email "juvi@iki.fi"

ENV EDITOR=emacs

# install clj-kondo
RUN cd /root && curl -sLO https://raw.githubusercontent.com/clj-kondo/clj-kondo/master/script/install-clj-kondo && chmod +x install-clj-kondo && ./install-clj-kondo

# install clojure surgeon
RUN cd /root && git clone https://github.com/realgenekim/clj-surgeon.git && cd clj-surgeon && mkdir -p ~/bin && make install
RUN mkdir -p ~/.pi/agent/skills/clj-surgeon && cp ~/clj-surgeon/skill.md ~/.pi/agent/skills/clj-surgeon/SKILL.md


# install clojure-lsp
RUN bash -ic 'bash < <(curl -s https://raw.githubusercontent.com/clojure-lsp/clojure-lsp/master/install)'
RUN ARCH=$(uname -m); if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then SUFFIX=aarch64; else SUFFIX=amd64-static; fi; \
    curl -fsSL -o /tmp/cljfmt.tar.gz "https://github.com/weavejester/cljfmt/releases/download/0.16.5/cljfmt-0.16.5-linux-${SUFFIX}.tar.gz" && tar -xzf /tmp/cljfmt.tar.gz -C /usr/local/bin && rm /tmp/cljfmt.tar.gz

CMD ["sleep", "infinity"]
