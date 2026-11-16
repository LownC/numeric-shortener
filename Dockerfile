# syntax=docker/dockerfile:1
FROM rust:1.99.1-trixie@sha256:8a4e90c7946b74626488b1446f712c0fe0ed1a596cbd3d871684bc9c5433ae07 AS builder
ARG SHORTENER_READ_ONLY_DEMO=true
ENV SHORTENER_READ_ONLY_DEMO=${SHORTENER_READ_ONLY_DEMO}
ARG DIOXUS_CLI_VERSION=0.7.10
ARG DIOXUS_CLI_SHA256=4363e4ed2a3f1eb7f4d38d2d59aed59ce43271c44c16b425e92c89a64761fbe7
RUN curl --fail --silent --show-error --location \
    "https://github.com/DioxusLabs/dioxus/releases/download/v${DIOXUS_CLI_VERSION}/dx-x86_64-unknown-linux-gnu.tar.gz" \
    --output /tmp/dx.tar.gz \
    && printf '%s  /tmp/dx.tar.gz\n' "$DIOXUS_CLI_SHA256" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/dx.tar.gz --directory /usr/local/bin \
    && rm /tmp/dx.tar.gz \
    && dx --version \
    && rustup target add wasm32-unknown-unknown --toolchain 1.99.1
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml Dioxus.toml ./
COPY src ./src
COPY assets ./assets
ENV CARGO_BUILD_JOBS=6 CARGO_INCREMENTAL=0 CARGO_TERM_COLOR=never IP=127.0.0.1 PORT=8080
RUN dx build --web --release --ssg --force-sequential true \
    && test -x target/dx/numeric-shortener/release/web/server \
    && test -f target/dx/numeric-shortener/release/web/public/index.html

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --user-group app
WORKDIR /app
COPY --from=builder --chown=app:app /app/target/dx/numeric-shortener/release/web/server ./server
COPY --from=builder --chown=app:app /app/target/dx/numeric-shortener/release/web/public ./public
ENV IP=0.0.0.0 PORT=8080 APP_ENV=production CREATE_URLS_ENABLED=false
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --max-time 4 "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1
CMD ["./server"]
