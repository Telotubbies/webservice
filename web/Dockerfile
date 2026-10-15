# Build: oven/bun -> static bundle, served by nginx on port 80.
# nginx proxies /api and /ws to the backend service (compose DNS name `backend`).
# bun.lock is the canonical lockfile (bun install --frozen-lockfile); npm users
# can still run `npm install` locally since package.json stays npm-compatible.

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
# UAT-only /crash-test route (v4 T12): baked in when the test overlay passes
# VITE_CRASH_TEST=1; plain `docker compose` builds ship without it.
ARG VITE_CRASH_TEST=
ENV VITE_CRASH_TEST=$VITE_CRASH_TEST
# Demo-data pages to show in this build (comma list or "all"; empty = real pages only).
ARG VITE_FEATURES=
ENV VITE_FEATURES=$VITE_FEATURES
RUN bun run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
