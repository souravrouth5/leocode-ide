import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { CSP_PLACEHOLDER, DEV_CSP, PROD_CSP } from "./src/csp"

/**
 * Replace the CSP placeholder in index.html. `npm run build` bakes the strict
 * policy; `npm run dev` swaps in the HMR-friendly variant so React Fast Refresh
 * keeps working without weakening the shipped APK.
 */
function cspPlugin(command: "build" | "serve") {
  const policy = command === "serve" ? DEV_CSP : PROD_CSP
  return {
    name: "leocode-csp",
    transformIndexHtml(html: string) {
      return html.replace(CSP_PLACEHOLDER, policy)
    }
  }
}

// Build output is copied into android/app/src/main/assets/web by the CI job.
export default defineConfig(({ command }) => ({
  plugins: [cspPlugin(command), react()],
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
    host: "0.0.0.0",
    port: 5173,
    strictPort: true
  }
}))
