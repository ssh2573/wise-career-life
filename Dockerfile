FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json index.html client.mjs sw.js manifest.webmanifest icon.svg server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node data ./data
COPY --chown=node:node scripts ./scripts
RUN mkdir /app/.runtime && chown node:node /app/.runtime
ENV HOST=0.0.0.0 PORT=4173 DATA_DIR=/app/.runtime
EXPOSE 4173
CMD ["node", "--use-env-proxy", "scripts/start.mjs"]
