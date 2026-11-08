# LendLoop n8n for Railway. Build context MUST be the repository root:
#   docker build -f deploy/railway/n8n/Dockerfile .
# On Railway set the service variable RAILWAY_DOCKERFILE_PATH=deploy/railway/n8n/Dockerfile and keep the root directory at "/".
FROM docker.n8n.io/n8nio/n8n:2.46.6

# Base image: USER node, ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"], no CMD (the base script runs `exec n8n`).
COPY --chown=node:node n8n/workflows/ /opt/lendloop/workflows/
COPY --chown=node:node n8n/scripts/bootstrap.mjs /opt/lendloop/bootstrap.mjs
COPY --chown=node:node deploy/railway/n8n/entrypoint.sh /opt/lendloop/entrypoint.sh

USER root
RUN chmod 0555 /opt/lendloop/entrypoint.sh
USER node

ENV WORKFLOWS_DIR=/opt/lendloop/workflows

# Keep tini as PID 1; our script validates env, imports credentials and workflows, then execs the base entrypoint.
ENTRYPOINT ["tini", "--", "/opt/lendloop/entrypoint.sh"]
