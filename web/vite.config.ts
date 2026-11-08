import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Build output is copied into android/app/src/main/assets/web by the CI job.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/language",
            "@codemirror/commands",
            "@codemirror/search",
            "@codemirror/autocomplete",
            "@codemirror/lang-python"
          ]
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
})
