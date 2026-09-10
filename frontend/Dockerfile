# TRACE frontend — Vite + React SPA, compiled to static assets and served
# by nginx. The API base URL is baked into the bundle at build time
# (frontend/src/config.js reads import.meta.env.VITE_API_BASE_URL), so it
# must be the URL the end user's BROWSER can reach the backend on — not a
# Docker network name. Override with --build-arg VITE_API_BASE_URL=...

# ----------------------------------------------------------------------------
# Stage 1 — build the static bundle
# ----------------------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ----------------------------------------------------------------------------
# Stage 2 — serve
# ----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
