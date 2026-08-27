FROM docker.io/library/ubuntu:22.04

ARG RUST_TOOLCHAIN=1.97.1
ARG NODE_VERSION=22.23.2
ARG NODE_LINUX_X64_SHA256=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307

ENV DEBIAN_FRONTEND=noninteractive

RUN mkdir -p /tmp/apt/lists/partial /tmp/apt/archives/partial \
    && apt-get \
      -o APT::Sandbox::User=root \
      -o Dir::State::lists=/tmp/apt/lists \
      -o Dir::Cache::archives=/tmp/apt/archives \
      update \
    && apt-get \
      -o APT::Sandbox::User=root \
      -o Dir::State::lists=/tmp/apt/lists \
      -o Dir::Cache::archives=/tmp/apt/archives \
      install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      file \
      git \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      libwebkit2gtk-4.1-dev \
      libxdo-dev \
      patchelf \
      pkg-config \
      xdg-utils \
      xz-utils \
    && rm -rf /tmp/apt

RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
      "https://nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      -o /tmp/node.tar.xz \
    && echo "${NODE_LINUX_X64_SHA256}  /tmp/node.tar.xz" | sha256sum --check --strict \
    && mkdir -p /opt/node \
    && tar --extract --xz --no-same-owner --file /tmp/node.tar.xz \
      --directory /opt/node --strip-components=1 \
    && rm /tmp/node.tar.xz

ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/opt/node/bin:${PATH}

RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
      https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" \
    && rustup component add clippy rustfmt \
    && rm /tmp/rustup-init.sh

WORKDIR /workspace
