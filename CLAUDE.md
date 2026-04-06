# mcp-server-qlever — MCP Server for QLever SPARQL Engine

Model Context Protocol server connecting Claude Code (and other MCP clients) to QLever knowledge graph endpoints. Published on npm.

## Tech Stack

- **Runtime:** Node.js >= 20, TypeScript (ES modules)
- **MCP SDK:** @modelcontextprotocol/sdk
- **Validation:** zod
- **Tests:** vitest
- **Build:** tsc (no bundler)
- **Package:** npm (mcp-server-qlever)

## Key Commands

```bash
npm run build          # tsc compile
npm run dev            # tsc --watch
npm run test           # vitest run (all tests)
npm run test:unit      # unit tests only
npm run test:integration  # needs QLever running
npm run test:ci        # spins up docker, runs unit+integration, tears down
npm run test:ci:gnd    # full test with GND dataset
npm start              # node dist/index.js
```

## Architecture

```
src/
  index.ts             Entry point, MCP server setup, CLI arg parsing
  tools.ts             Core MCP tool definitions (sparql_query, search, etc.)
  advanced-tools.ts    Extended tools (spatial, update, autocomplete)
  qlever-client.ts     HTTP client for QLever API
  prompts.ts           MCP prompt templates
  format-helpers.ts    Result formatting utilities
test/
  unit/                Pure logic tests (no network)
  integration/         Tests against running QLever
  e2e/                 Full MCP protocol tests
  fixtures/            Test data
  helpers.ts           Shared test utilities
  mock-server.ts       QLever mock for unit tests
examples/
  gnd/                 German National Library dataset example
```

## Domain Rules

- All SPARQL handling must sanitize IRIs and prevent injection
- New tools must follow MCP protocol spec (inputSchema with zod, proper error responses)
- Keep dependencies minimal — this ships as an npm package
- Docker Compose files: `test.yml` for CI, `allinone.yml` for demo, `gnd.yml` for real data

## Do NOT

- Add runtime dependencies without strong justification (ships as lightweight npm package)
- Skip IRI validation or SPARQL sanitization in new tools
- Break the CLI interface (`-e` flag for endpoint URL)
- Modify test fixtures without updating corresponding test expectations
- Use CommonJS imports — this is an ES module project (`"type": "module"`)
