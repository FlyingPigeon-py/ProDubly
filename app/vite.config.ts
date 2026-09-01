import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify(
      new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    )
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    target: "safari15"
  }
});
