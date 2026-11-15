#!/usr/bin/env node
// npm run seed -- --preset=minimal|demo
// Forwards the preset to `medusa exec` in apps/backend (the Medusa CLI rejects unknown flags).
import { spawnSync } from "node:child_process"

const arg = process.argv.slice(2).find((a) => a.startsWith("--preset=") || !a.startsWith("-"))
const preset = arg?.replace(/^--preset=/, "")
if (!preset) {
  console.error("Missing preset. Usage: npm run seed -- --preset=minimal|demo")
  process.exit(1)
}
const { status } = spawnSync(
  "pnpm",
  ["--filter", "@store/backend", "exec", "medusa", "exec", "./src/scripts/seed.ts", preset],
  { stdio: "inherit" }
)
process.exit(status ?? 1)
