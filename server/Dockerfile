# CodeDesk run server. Build context: the "server" folder.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

# Compilers/interpreters for the supported languages, plus tini (cleans up killed processes),
# util-linux (prlimit) and iptables (optional network blocking)
RUN apt-get update && apt-get install -y --no-install-recommends \
      nodejs npm tini util-linux iptables ca-certificates \
      python3 gcc g++ libc6-dev default-jdk-headless golang-go rustc ruby php-cli \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js entrypoint.sh ./

# The app is owned by root. Student programs run as unprivileged user IDs 20000-20015
# (one per running program) and cannot change it. Put NO secrets in this container.
ENV HOST=0.0.0.0 RUN_AS_UID=20000 GOCACHE=/tmp/go-build-cache
EXPOSE 10000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "/app/entrypoint.sh"]
