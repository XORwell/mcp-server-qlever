#!/usr/bin/env node

/**
 * mcp-server-qlever — MCP server for the QLever SPARQL engine.
 *
 * Connects Claude Code (or any MCP client) to a QLever instance, exposing
 * SPARQL query execution, entity lookup, schema exploration, and index
 * statistics as MCP tools.
 *
 * Usage:
 *   mcp-server-qlever --endpoint <url> [--access-token <token>] [--timeout <duration>]
 *
 * Environment variables:
 *   QLEVER_ENDPOINT      — QLever API URL (fallback if --endpoint not given)
 *   QLEVER_ACCESS_TOKEN  — Access token for privileged operations
 *   QLEVER_TIMEOUT       — Default query timeout (e.g. "30s")
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { QleverClient } from "./qlever-client.js";
import { registerTools } from "./tools.js";
import { registerAdvancedTools } from "./advanced-tools.js";
import { registerPrompts } from "./prompts.js";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  endpoint?: string;
  accessToken?: string;
  timeout?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const value = (): string => {
      // Tokens may legitimately start with "-"; other values may not.
      const isToken = arg === "--access-token" || arg === "--token" || arg === "-t";
      if (next === undefined || (!isToken && next.startsWith("-"))) {
        console.error(`Error: ${arg} requires a value.\nRun with --help for usage information.`);
        process.exit(1);
      }
      i++;
      return next;
    };
    switch (arg) {
      case "--endpoint":
      case "-e":
        args.endpoint = value();
        break;
      case "--access-token":
      case "--token":
      case "-t":
        args.accessToken = value();
        break;
      case "--timeout":
        args.timeout = value();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--version":
      case "-v":
        console.error(`mcp-server-qlever ${PKG_VERSION}`);
        process.exit(0);
        break;
    }
  }
  return args;
}

function printHelp(): void {
  const help = `
mcp-server-qlever — MCP server for the QLever SPARQL engine

USAGE
  mcp-server-qlever --endpoint <url> [options]

OPTIONS
  -e, --endpoint <url>      QLever API endpoint URL (required)
                             Also: QLEVER_ENDPOINT env var
  -t, --access-token <tok>  Access token for privileged operations
                             Also: QLEVER_ACCESS_TOKEN env var
      --timeout <duration>   Default query timeout (e.g. "30s", "2min")
                             Also: QLEVER_TIMEOUT env var
                             Default: 30s
  -h, --help                Show this help message
  -v, --version             Show version

EXAMPLES
  # Local QLever instance (Docker)
  mcp-server-qlever -e http://localhost:7019

  # With access token
  mcp-server-qlever -e http://localhost:7019 -t my-secret-token

  # Configure via environment
  QLEVER_ENDPOINT=http://localhost:7019 mcp-server-qlever
`.trimStart();
  console.error(help);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const endpoint =
    args.endpoint ?? process.env.QLEVER_ENDPOINT;
  const accessToken =
    args.accessToken ?? process.env.QLEVER_ACCESS_TOKEN;
  const timeout =
    args.timeout ?? process.env.QLEVER_TIMEOUT ?? "30s";

  if (!/^\d+(ns|us|ms|s|min|h)$/.test(timeout)) {
    console.error(
      `Error: invalid timeout "${timeout}". Expected <number><unit> with unit ns, us, ms, s, min or h (e.g. "30s").`,
    );
    process.exit(1);
  }

  if (endpoint) {
    try {
      const protocol = new URL(endpoint).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new Error();
    } catch {
      console.error(`Error: invalid endpoint URL "${endpoint}". Expected an http(s) URL.`);
      process.exit(1);
    }
  }

  if (!endpoint) {
    console.error(
      "Error: QLever endpoint is required.\n" +
        "Provide --endpoint <url> or set QLEVER_ENDPOINT.\n" +
        "Run with --help for usage information.",
    );
    process.exit(1);
  }

  const client = new QleverClient({ endpoint, accessToken, defaultTimeout: timeout });

  const server = new McpServer({
    name: "mcp-server-qlever",
    version: PKG_VERSION,
    description:
      "Query knowledge graphs via the QLever SPARQL engine. " +
      `Connected to: ${endpoint}`,
  });

  registerTools(server, client);
  registerAdvancedTools(server, client);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol messages)
  console.error(`mcp-server-qlever connected to ${endpoint}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
