FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Base OS packages + Java + tools commonly needed in Clojure/CLJS projects
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    gnupg \
    rlwrap \
    unzip \
    zip \
    bash \
    openssh-client \
    openjdk-21-jdk \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 from NodeSource
# NodeSource documents setup_22.x for Debian/Ubuntu installs.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh \
    && bash /tmp/nodesource_setup.sh \
    && apt-get update && apt-get install -y nodejs \
    && rm -f /tmp/nodesource_setup.sh \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g yarn
RUN npm install -g @mariozechner/pi-coding-agent

# Install Leiningen
# Leiningen's GitHub mirror states the project is moving to Codeberg,
# but the stable script URL remains the usual installer entry point.
RUN curl -fsSL https://raw.githubusercontent.com/technomancy/leiningen/stable/bin/lein \
      -o /usr/local/bin/lein \
    && chmod +x /usr/local/bin/lein

# Create a non-root user
# RUN useradd -ms /bin/bash dev \
#     && mkdir -p /workspace /home/dev/.npm /home/dev/.m2 /home/dev/.lein \
#     && chown -R dev:dev /workspace /home/dev

USER ubuntu
WORKDIR /workspace

# ENV HOME=/home/dev
# ENV PATH="/home/dev/.npm-global/bin:${PATH}"

# Warm up lein so the standalone jar gets downloaded during image build
RUN lein version || true

RUN git config --global user.name "Jukka Villstedt"
RUN git config --global user.email "juvi@iki.fi"

CMD ["/bin/bash"]