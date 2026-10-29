import { existsSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// The eval key lives in .env.eval.local (git-ignored by .env*), never in the code or the chat.
if (existsSync(".env.eval.local")) process.loadEnvFile(".env.eval.local");

/** Live evals: real model calls, slow, never part of `pnpm test`. Run with `pnpm eval`. */
export default mergeConfig(base, defineConfig({ test: { include: ["evals/**/*.eval.ts"], testTimeout: 3_600_000, maxWorkers: 1 } }));
