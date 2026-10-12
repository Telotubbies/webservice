# Build: oven/bun -> static bundle, served by nginx on port 80.
# nginx proxies /api and /ws to the backend service (compose DNS name `backend`).
# bun.lock is the canonical lockfile (bun install --frozen-lockfile); npm users
# can still run `npm install` locally since package.json stays npm-compatible.

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
