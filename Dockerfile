FROM node:latest

RUN mkdir /app

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ENV DATABASE_URL_SOURCE=postgresql://username:password@host:port/database_name
ENV DATABASE_URL_TARGET=postgresql://username:password@host:port/database_name

ENV SCHEDULE_TIME="0 0 * * *"
ENV SCHEDULE_TIMEZONE=UTC

ENV RUN_ON_STARTUP=true
ENV PORT=3000
ENV LOGGER_LEVEL=info

ENV DISCORD_ENABLED=false
ENV DISCORD_WEBHOOK_URL=

ENV FAILOVER_RETRIES=3
ENV FAILOVER_RETRY_DELAY_MS=10000

RUN apt-get update
RUN apt-get install -y curl apt-transport-https apt-utils gpg
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
RUN echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt/ bookworm-pgdg main" | tee /etc/apt/sources.list.d/postgresql.list
RUN apt-get update
RUN apt-get install -y postgresql-client-16

CMD ["sh", "docker-entrypoint.sh"]