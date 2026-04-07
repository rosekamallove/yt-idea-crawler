FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts/ scripts/
COPY src/ src/

CMD ["npx", "tsx", "scripts/run.ts"]
