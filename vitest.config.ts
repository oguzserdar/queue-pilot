import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Nine suites build a real Postgres (PGlite) with every migration in beforeAll. Under load that can pass 10 s while
    // several build at once; the setup is slow, not wrong, so setup gets 30 s. Test bodies keep the 5 s default.
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
