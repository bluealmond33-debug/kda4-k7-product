import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 로컬 데모 HTTPS — 아이폰 Safari 등은 http+LAN IP에서 getUserMedia(마이크)를 아예 막는다
// (보안 컨텍스트 아님). .certs/에 자체서명 인증서가 있으면(scripts/dev-https-cert 참고) 켠다.
// 없으면(다른 개발자 환경) 평소처럼 http로 뜬다 — 필수 아님.
const certFile = ".certs/cert.pem";
const keyFile = ".certs/key.pem";
const https =
  existsSync(certFile) && existsSync(keyFile)
    ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
    : undefined;

// base: './' keeps asset paths relative so the build works both at a domain
// root (Vercel) and under a sub-path (static preview).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { https },
});
