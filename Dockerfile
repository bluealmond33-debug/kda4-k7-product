# syntax=docker/dockerfile:1

# ---- 빌드 스테이지: Vite 정적 빌드 ----
FROM node:20-slim AS build
WORKDIR /app
# Vite 환경변수는 빌드 시 주입된다(런타임 변경 불가)
ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_DATA_API_PREFIX=/api/v1
ARG VITE_USE_REAL_DATA_API=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_DATA_API_PREFIX=$VITE_DATA_API_PREFIX \
    VITE_USE_REAL_DATA_API=$VITE_USE_REAL_DATA_API
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 서빙 스테이지: nginx ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
