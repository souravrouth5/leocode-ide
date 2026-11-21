import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // React Testing Library needs the development build of React. The ambient
    // shell may export NODE_ENV=production, which made `act()` throw in every
    // component test.
    env: { NODE_ENV: "development" }
  }
})
