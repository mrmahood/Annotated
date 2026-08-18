# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 docker.io/library/node@sha256:e484ae3f1e3c378021c967fd42254f343c302a9263e412280eac32bf5bca7008 AS node_runtime

FROM --platform=linux/amd64 docker.io/library/postgres@sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3 AS runtime

ARG FFMPEG_VERSION=n8.1.2-44-g7c533d0f86-20260816
ADD --checksum=sha256:3a379bb6ce47ca7c175999ed44a8f386cc89a9b9e450774b69d98a2c45c5189b \
  https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-16-13-00/ffmpeg-n8.1.2-44-g7c533d0f86-linux64-lgpl-8.1.tar.xz \
  /tmp/ffmpeg.tar.xz

USER root
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
RUN set -eu; \
  mkdir -p /tmp/ffmpeg; \
  tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1; \
  install -m 0755 /tmp/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg; \
  install -m 0755 /tmp/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe; \
  mkdir -p /usr/share/doc/ffmpeg; \
  install -m 0644 /tmp/ffmpeg/LICENSE.txt /usr/share/doc/ffmpeg/LICENSE.txt; \
  rm -rf /tmp/ffmpeg /tmp/ffmpeg.tar.xz; \
  groupadd --system --gid 10001 annotated-worker; \
  useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin annotated-worker; \
  test "$(ffmpeg -hide_banner -version | sed -n '1s/^ffmpeg version //p' | awk '{print $1}')" = "$FFMPEG_VERSION"; \
  test "$(ffprobe -hide_banner -version | sed -n '1s/^ffprobe version //p' | awk '{print $1}')" = "$FFMPEG_VERSION"; \
  test "$(node --version)" = "v24.14.1"; \
  test "$(/usr/lib/postgresql/17/bin/psql --version | awk '{print $3}')" = "17.6"

WORKDIR /opt/annotated
COPY --chown=10001:10001 src ./src

ENV NODE_ENV=production \
  ANNOTATED_FFMPEG_PATH=/usr/local/bin/ffmpeg \
  ANNOTATED_FFPROBE_PATH=/usr/local/bin/ffprobe \
  ANNOTATED_PSQL_PATH=/usr/lib/postgresql/17/bin/psql \
  ANNOTATED_LEASE_SECONDS=900 \
  ANNOTATED_WORKER_TIMEOUT_MS=600000

LABEL org.opencontainers.image.title="Annotated media worker" \
  org.opencontainers.image.description="Bounded one-media Phase C worker" \
  org.opencontainers.image.source="https://github.com/Annotated-com/Annotated" \
  org.opencontainers.image.licenses="UNLICENSED"

USER 10001:10001
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/opt/annotated/src/entrypoint/main.mjs"]
CMD ["worker"]
