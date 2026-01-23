#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  return [
    "Usage:",
    "  npm run npm:dist-tag -- --tag <tag> [--package <name>] [--version <ver>] [--from <dist-tag>] [--registry <url>] [--dry-run] [--no-verify]",
    "",
    "Examples:",
    "  npm run npm:dist-tag:happy",
    "  npm run npm:dist-tag -- --tag happy-codex-resume",
    "  npm run npm:dist-tag -- --tag happy --package @leeroy/codex-mcp-resume",
    "  npm run npm:dist-tag -- --tag happy --from latest",
    "  npm run npm:dist-tag -- --tag happy --version 1.2.3",
    "",
    "Notes:",
    "  - Auth is handled by your local npm config (~/.npmrc) or environment.",
    "  - If --version is omitted, the version is read from --from (default: latest).",
    "  - NPM dist-tag updates can take a few seconds to show up in `npm view`; this script retries verification.",
  ].join("\n");
}

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(cmd, args, { stdio = "pipe" } = {}) {
  const res = spawnSync(cmd, args, {
    stdio,
    encoding: "utf8",
    env: process.env,
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    const stderr = (res.stderr || "").trim();
    const stdout = (res.stdout || "").trim();
    const extra = [stderr, stdout].filter(Boolean).join("\n");
    die(
      extra
        ? `Command failed: ${cmd} ${args.join(" ")}\n${extra}`
        : `Command failed: ${cmd} ${args.join(" ")}`,
    );
  }

  return res;
}

function npmArgsWithRegistry(args, registry) {
  if (!registry) return args;
  return [...args, "--registry", registry];
}

function npmViewJson(pkg, field, registry) {
  const res = run(
    "npm",
    npmArgsWithRegistry(["view", pkg, field, "--json"], registry),
  );
  const raw = (res.stdout || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(
      `Failed to parse npm view output as JSON.\nField: ${field}\nOutput: ${raw}\nError: ${err?.message || String(err)}`,
    );
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readDefaultPackageName(repoRoot) {
  const candidate = path.join(
    repoRoot,
    "codex-rs",
    "mcp-server",
    "npm",
    "package.json",
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    return typeof parsed?.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {
    pkg: null,
    tag: null,
    version: null,
    from: "latest",
    registry: null,
    dryRun: false,
    verify: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }

    if (arg === "--no-verify") {
      out.verify = false;
      continue;
    }

    const takeValue = () => {
      if (i + 1 >= argv.length) die(`Missing value for ${arg}`);
      i += 1;
      return argv[i];
    };

    if (arg === "--package" || arg === "-p") {
      out.pkg = takeValue();
      continue;
    }
    if (arg.startsWith("--package=")) {
      out.pkg = arg.slice("--package=".length);
      continue;
    }

    if (arg === "--tag" || arg === "-t") {
      out.tag = takeValue();
      continue;
    }
    if (arg.startsWith("--tag=")) {
      out.tag = arg.slice("--tag=".length);
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      out.version = takeValue();
      continue;
    }
    if (arg.startsWith("--version=")) {
      out.version = arg.slice("--version=".length);
      continue;
    }

    if (arg === "--from") {
      out.from = takeValue();
      continue;
    }
    if (arg.startsWith("--from=")) {
      out.from = arg.slice("--from=".length);
      continue;
    }

    if (arg === "--registry") {
      out.registry = takeValue();
      continue;
    }
    if (arg.startsWith("--registry=")) {
      out.registry = arg.slice("--registry=".length);
      continue;
    }

    die(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return out;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const pkg =
    args.pkg ||
    process.env.FORK_NPM_PACKAGE_NAME ||
    readDefaultPackageName(repoRoot) ||
    null;
  if (!pkg)
    die(
      "Missing package name. Provide --package or set FORK_NPM_PACKAGE_NAME.",
    );

  const tag = args.tag;
  if (!tag) die(`Missing --tag.\n\n${usage()}`);

  const distTags = npmViewJson(pkg, "dist-tags", args.registry);
  if (!distTags || typeof distTags !== "object")
    die(`Unable to read dist-tags for ${pkg}. Are you logged into npm?`);

  const version = args.version || distTags[args.from];
  if (!version || typeof version !== "string") {
    die(
      `Unable to determine version to tag for ${pkg}. Missing dist-tag "${args.from}" or use --version.`,
    );
  }

  if (distTags[tag] === version) {
    process.stdout.write(`${pkg}@${version} is already tagged as "${tag}".\n`);
    return;
  }

  const target = `${pkg}@${version}`;
  const cmd = ["dist-tag", "add", target, tag];

  if (args.dryRun) {
    process.stdout.write(`[dry-run] npm ${cmd.join(" ")}\n`);
    return;
  }

  run("npm", npmArgsWithRegistry(cmd, args.registry), { stdio: "inherit" });

  if (args.verify) {
    // NPM dist-tag changes can take a short moment to propagate to `npm view`.
    const maxWaitMs = 30_000;
    const start = Date.now();
    let updated = {};

    while (true) {
      updated = npmViewJson(pkg, "dist-tags", args.registry) || {};
      if (updated[tag] === version) break;

      if (Date.now() - start >= maxWaitMs) {
        process.stderr.write(
          [
            `Warning: npm dist-tag add succeeded, but "${tag}" is not visible via npm view yet.`,
            `Expected: ${version}`,
            `Observed: ${updated[tag] || "<missing>"}`,
            `This can be normal propagation delay; re-check with: npm view ${pkg} dist-tags --json`,
          ].join("\n") + "\n",
        );
        break;
      }

      sleepMs(1000);
    }
  }

  process.stdout.write(`Tagged ${target} as "${tag}".\n`);
}

main();
