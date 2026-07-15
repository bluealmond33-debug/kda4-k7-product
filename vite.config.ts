import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: './' keeps asset paths relative so the build works both at a domain
// root (Vercel) and under a sub-path (static preview).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
