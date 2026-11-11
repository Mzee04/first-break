import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"

const serverPort = process.env.SERVER_PORT || "43124"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
      "/fixture": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
    },
  },
})
