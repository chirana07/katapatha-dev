#!/usr/bin/env node
/* eslint-env node */

/**
 * Rehearsal reset: drops the Prisma schema, re-applies migrations, and
 * re-seeds the DB to a known demo state. Takes about ten seconds against
 * local Postgres.
 *
 * Usage:
 *   pnpm demo:reset
 *   pnpm demo:reset --yes       # skip the confirm prompt
 *
 * Safety: refuses to run against a DATABASE_URL whose database name
 * contains "prod" so a stray env in a deploy session can't nuke anything
 * important. Set DEMO_RESET_FORCE=1 to override.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function env(name) {
  const value = process.env[name];
  return typeof value === "string" ? value : "";
}

function red(message) {
  return `\u001b[31m${message}\u001b[0m`;
}

function green(message) {
  return `\u001b[32m${message}\u001b[0m`;
}

function dim(message) {
  return `\u001b[2m${message}\u001b[0m`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    cwd: options.cwd ?? repoRoot,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(red(`\n✗ ${command} ${args.join(" ")} exited with code ${result.status}`));
    process.exit(result.status ?? 1);
  }
}

function databaseLooksProd(url) {
  if (!url) return false;
  try {
    const dbName = new URL(url).pathname.replace(/^\//, "").toLowerCase();
    return /prod/.test(dbName);
  } catch {
    return false;
  }
}

async function confirm(prompt) {
  if (process.argv.includes("--yes")) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  const url = env("DATABASE_URL");
  if (!url) {
    console.error(
      red("DATABASE_URL is not set.") +
        " Point it at the database you want to reset, then try again.",
    );
    process.exit(1);
  }

  const dbLabel = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname.replace(/^\//, "")} on ${parsed.host}`;
    } catch {
      return "the configured database";
    }
  })();

  if (databaseLooksProd(url) && env("DEMO_RESET_FORCE") !== "1") {
    console.error(
      red("Refusing to reset: DATABASE_URL looks like a production database.") +
        "\nSet DEMO_RESET_FORCE=1 to override.",
    );
    process.exit(1);
  }

  console.log(green("Rehearsal reset"));
  console.log(dim(`target: ${dbLabel}`));
  const ok = await confirm(
    "This drops every row and reseeds the demo state. Type 'yes' to continue: ",
  );
  if (!ok) {
    console.log("Cancelled.");
    process.exit(0);
  }

  console.log(dim("\n→ prisma migrate reset --force --skip-seed"));
  run(
    "./node_modules/.bin/prisma",
    ["migrate", "reset", "--force", "--skip-seed"],
    { cwd: path.join(repoRoot, "apps/api") },
  );

  console.log(dim("\n→ tsx prisma/seed/index.ts"));
  run(
    "./node_modules/.bin/tsx",
    ["prisma/seed/index.ts"],
    { cwd: path.join(repoRoot, "apps/api") },
  );

  console.log(green("\n✓ Demo state ready."));
  console.log("Seed accounts (shared password is 'waypoint'):");
  console.log("  nimal@waypoint.lk    DISPATCHER   depot Peliyagoda");
  console.log("  ranjith@waypoint.lk  LOADER       depot Peliyagoda");
  console.log("  sunil@waypoint.lk    DRIVER       claims VEH101 at the dock");
  console.log("  fathima@waypoint.lk  STORE_MANAGER outlet OUT074");
  console.log(
    dim(
      "\nTip: `pnpm --filter @katapatha/web dev` + open /access to one-click a role.",
    ),
  );
}

await main().catch((error) => {
  console.error(red(`\n✗ demo:reset failed: ${error?.message ?? error}`));
  process.exit(1);
});
