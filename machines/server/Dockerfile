# The tenbox server image: bun, the production dependencies, domain/ and server/.
# Build from the repo root: docker build -f machines/server/Dockerfile -t tenbox-server .
FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY domain ./domain
COPY server ./server
ENV TENBOX_SERVER_HOST=0.0.0.0 \
    TENBOX_SERVER_PORT=4300 \
    TENBOX_SERVER_DB=/data/server.db
RUN printf '#!/bin/sh\nexec bun run /app/server/main.ts "$@"\n' > /usr/local/bin/tenbox-server \
 && chmod +x /usr/local/bin/tenbox-server \
 && mkdir /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 4300
ENTRYPOINT ["bun", "run", "server/main.ts"]
