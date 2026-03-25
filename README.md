# mcp-server-qlever

[![npm version](https://img.shields.io/npm/v/mcp-server-qlever)](https://www.npmjs.com/package/mcp-server-qlever)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the
[QLever](https://qlever.cs.uni-freiburg.de/) SPARQL engine. Connect Claude Code or
any MCP-compatible client to large-scale knowledge graphs like Wikidata,
OpenStreetMap, DBLP, and more.

## Features

- Execute SPARQL queries with formatted text or raw JSON output
- Explore dataset schemas by listing predicates ordered by frequency
- Look up entities by IRI with outgoing and incoming triples
- Search for entities by label using full-text matching
- Retrieve index metadata (triple count, predicates, subjects, objects)
- Works with any public or private QLever instance

## Quick Start

Run directly with `npx` against the public Wikidata endpoint:

```bash
npx mcp-server-qlever --endpoint https://qlever.cs.uni-freiburg.de/api/wikidata
```

## Installation

```bash
# Global install
npm install -g mcp-server-qlever

# Or run without installing
npx mcp-server-qlever --endpoint <url>
```

Requires Node.js 18 or later.

## Configuration

### Claude Code (CLI)

Add the server to your project or user configuration with a single command:

```bash
claude mcp add qlever-wikidata -- npx -y mcp-server-qlever --endpoint https://qlever.cs.uni-freiburg.de/api/wikidata
```

This writes the entry into `.claude/settings.json` (project-scoped). To add it
globally for all projects, use the `-s user` flag:

```bash
claude mcp add -s user qlever-wikidata -- npx -y mcp-server-qlever --endpoint https://qlever.cs.uni-freiburg.de/api/wikidata
```

You can verify the server is registered:

```bash
claude mcp list
```

### Claude Code (VS Code / Cursor)

Open **Settings** (`Ctrl+,` / `Cmd+,`), search for `claude code mcp`, and add
an entry under **MCP Servers**, or edit your `settings.json` directly:

```jsonc
// .vscode/settings.json (project) or User Settings (global)
{
  "claude-code.mcpServers": {
    "qlever-wikidata": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server-qlever",
        "--endpoint",
        "https://qlever.cs.uni-freiburg.de/api/wikidata"
      ]
    }
  }
}
```

### Manual configuration (any MCP client)

If you prefer to edit the config file directly, add this to your
`~/.claude.json` (or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "qlever-wikidata": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server-qlever",
        "--endpoint",
        "https://qlever.cs.uni-freiburg.de/api/wikidata"
      ]
    }
  }
}
```

For a private QLever instance with an access token, use environment variables:

```json
{
  "mcpServers": {
    "qlever-local": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server-qlever",
        "--endpoint",
        "http://localhost:7019"
      ],
      "env": {
        "QLEVER_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Multiple endpoints

You can register several QLever instances under different names:

```json
{
  "mcpServers": {
    "qlever-wikidata": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "-e", "https://qlever.cs.uni-freiburg.de/api/wikidata"]
    },
    "qlever-osm": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "-e", "https://qlever.cs.uni-freiburg.de/api/osm-planet"]
    },
    "qlever-dblp": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "-e", "https://qlever.cs.uni-freiburg.de/api/dblp"]
    }
  }
}
```

### Other MCP clients

The server communicates via stdin/stdout using the MCP protocol. Start it as a
subprocess and connect over stdio:

```bash
mcp-server-qlever --endpoint https://qlever.cs.uni-freiburg.de/api/wikidata
```

## Tool Reference

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `sparql_query` | Execute SPARQL and get formatted text results | `query`, `timeout`, `max_rows` |
| `sparql_query_json` | Execute SPARQL and get raw JSON response | `query`, `timeout`, `max_rows` |
| `get_index_stats` | Retrieve dataset metadata (triple count, predicates, etc.) | -- |
| `describe_entity` | Look up all triples for an entity by IRI | `iri`, `limit` |
| `search_entities` | Full-text search for entities by label | `search_term`, `label_predicate`, `limit` |
| `get_predicates` | List available predicates ordered by frequency | `limit` |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QLEVER_ENDPOINT` | QLever API URL (fallback if `--endpoint` not given) | -- |
| `QLEVER_ACCESS_TOKEN` | Access token for privileged operations | -- |
| `QLEVER_TIMEOUT` | Default query timeout (e.g. `30s`, `2min`) | `30s` |

CLI flags take precedence over environment variables.

## CLI Usage

```
mcp-server-qlever --endpoint <url> [options]

Options:
  -e, --endpoint <url>      QLever API endpoint URL (required)
  -t, --access-token <tok>  Access token for privileged operations
      --timeout <duration>   Default query timeout (default: 30s)
  -h, --help                Show help message
  -v, --version             Show version
```

## Development

```bash
git clone https://github.com/XORwell/mcp-server-qlever.git
cd mcp-server-qlever
npm install
npm run build
npm test
```

### Docker Testing

Run integration tests against a real QLever instance:

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm test
docker compose -f docker-compose.test.yml down -v
```

Or use the convenience script:

```bash
npm run test:ci
```

## License

[MIT](LICENSE)

## Links

- [QLever](https://qlever.cs.uni-freiburg.de/) -- High-performance SPARQL engine (University of Freiburg)
- [Model Context Protocol](https://modelcontextprotocol.io) -- MCP specification
- [GitHub Issues](https://github.com/XORwell/mcp-server-qlever/issues) -- Bug reports and feature requests
