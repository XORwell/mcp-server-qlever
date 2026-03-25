# mcp-server-qlever

[![npm version](https://img.shields.io/npm/v/mcp-server-qlever)](https://www.npmjs.com/package/mcp-server-qlever)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the
[QLever](https://github.com/ad-freiburg/qlever) SPARQL engine. Connect Claude Code or
any MCP-compatible client to knowledge graphs powered by QLever.

## Features

- Execute SPARQL queries with formatted text or raw JSON output
- Explore dataset schemas by listing predicates ordered by frequency
- Look up entities by IRI with outgoing and incoming triples
- Search for entities by label using full-text matching
- Context-sensitive SPARQL autocompletion via QLever's `/ac` endpoint
- Query plan analysis without execution
- Geographic search (radius / bounding box) via QLever's native spatial join
- SPARQL 1.1 Update with dry-run preview and safety guards
- Works with any QLever instance (local Docker, self-hosted, or public)

## Quick Start

### 1. Start a QLever instance with Docker

The fastest way to get a working QLever endpoint is with Docker. This example
uses the [Olympics dataset](https://github.com/wallscope/olympics-rdf) (~200K triples):

```bash
docker run -d --name qlever -p 7019:7019 \
  adfreiburg/qlever:latest \
  bash -c "qlever setup-config olympics && qlever get-data && qlever index && qlever start && sleep infinity"
```

Or use the bundled test dataset (scientists, ~40 triples) for development:

```bash
docker compose -f docker-compose.test.yml up -d --wait
```

### 2. Connect the MCP server

```bash
npx mcp-server-qlever --endpoint http://localhost:7019
```

Verify it works:

```bash
# In another terminal, check the index stats
curl -s "http://localhost:7019/?cmd=stats" | head -5
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
claude mcp add qlever -- npx -y mcp-server-qlever --endpoint http://localhost:7019
```

This writes the entry into `.claude/settings.json` (project-scoped). To add it
globally for all projects, use the `-s user` flag:

```bash
claude mcp add -s user qlever -- npx -y mcp-server-qlever --endpoint http://localhost:7019
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
    "qlever": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server-qlever",
        "--endpoint",
        "http://localhost:7019"
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
    "qlever": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server-qlever",
        "--endpoint",
        "http://localhost:7019"
      ]
    }
  }
}
```

For a QLever instance with an access token, use environment variables:

```json
{
  "mcpServers": {
    "qlever": {
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

You can register several QLever instances under different names. Each runs its
own Docker container on a different port:

```json
{
  "mcpServers": {
    "qlever-wikidata": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "-e", "http://localhost:7019"]
    },
    "qlever-osm": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "-e", "http://localhost:7020"]
    },
    "qlever-dblp": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "-e", "http://localhost:7021"]
    }
  }
}
```

### Other MCP clients

The server communicates via stdin/stdout using the MCP protocol. Start it as a
subprocess and connect over stdio:

```bash
mcp-server-qlever --endpoint http://localhost:7019
```

## Running QLever with Docker

QLever requires a two-step process: build an index from RDF data, then serve it.
The `qlever` CLI tool (bundled in the Docker image) simplifies this.

### Using a preconfigured dataset

```bash
# Start a container
docker run -it --name qlever-wikidata -p 7019:7019 adfreiburg/qlever:latest bash

# Inside the container:
qlever setup-config wikidata    # or: olympics, dblp, osm-planet, uniprot, ...
qlever get-data                 # downloads the dataset
qlever index                    # builds the index (may take minutes to hours)
qlever start                    # starts the SPARQL server on port 7019
```

### Using your own RDF data

```bash
docker run -it --name qlever-custom -p 7019:7019 \
  -v /path/to/your/data:/data \
  adfreiburg/qlever:latest bash

# Inside the container:
qlever-index -i /data/myindex -f /data/mydata.nt -F nt \
  -s /data/settings.json
qlever-server -i /data/myindex -p 7019 -m 4GB
```

See the [QLever documentation](https://docs.qlever.dev/) for details on dataset
configuration, index settings, and performance tuning.

## QLever-Specific Features

This server goes beyond generic SPARQL access by exposing QLever's unique capabilities:

- **Context-sensitive autocompletion** -- The `sparql_autocomplete` tool uses QLever's `/ac` endpoint to suggest completions based on what actually exists in the index, not just syntactic possibilities.
- **Query plan analysis** -- The `analyze_query` tool returns QLever's internal query plan with estimated result sizes, helping predict performance before execution.
- **Full-text search** -- The `search_fulltext` tool uses QLever's SPARQL+Text extension to find entities co-occurring with keywords in the text corpus.
- **Spatial queries** -- The `spatial_query` tool uses QLever's native spatial join (SIGSPATIAL'25) for efficient geographic searches.
- **Safe SPARQL Update** -- The `sparql_update` tool includes dry-run preview, dangerous operation detection, and access token enforcement.

## Tool Reference

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `sparql_query` | Execute SPARQL and get formatted text results | `query`, `timeout`, `max_rows` |
| `sparql_query_json` | Execute SPARQL and get raw JSON response | `query`, `timeout`, `max_rows` |
| `get_index_stats` | Retrieve dataset metadata (triple count, predicates, etc.) | -- |
| `describe_entity` | Look up all triples for an entity by IRI | `iri`, `limit` |
| `search_entities` | Full-text search for entities by label | `search_term`, `label_predicate`, `limit` |
| `get_predicates` | List available predicates ordered by frequency | `limit` |
| `sparql_autocomplete` | Context-sensitive autocompletion using QLever's /ac endpoint | `partial_query`, `context`, `entity_name`, `limit` |
| `analyze_query` | Get query execution plan without running the query | `query` |
| `list_named_graphs` | List all named graphs with triple counts | `limit` |
| `search_fulltext` | Search QLever's text index for entity-keyword co-occurrence | `keywords`, `filter_type`, `limit` |
| `spatial_query` | Geographic search (radius or bounding box) using QLever's spatial join | `mode`, `lat`, `lon`, `radius_km` / bbox params, `limit` |
| `sparql_update` | Execute SPARQL 1.1 Update (requires access token) | `update`, `graph_uri`, `dry_run`, `confirm` |

## Prompts

The server exposes MCP Prompts that guide LLM workflows:

| Prompt | Description |
|--------|-------------|
| `explore_dataset` | Step-by-step workflow for discovering an unknown QLever dataset |
| `safe_update_workflow` | Validated workflow for SPARQL Update operations with dry-run preview |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QLEVER_ENDPOINT` | QLever API URL (fallback if `--endpoint` not given) | -- |
| `QLEVER_ACCESS_TOKEN` | Access token for privileged operations | -- |
| `QLEVER_TIMEOUT` | Default query timeout (e.g. `30s`, `2min`) | `30s` |

The access token is required for `sparql_update` operations and recommended for
private QLever instances. It is sent as `Authorization: Bearer` header on all
requests when configured.

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
npm test          # runs unit tests (no Docker needed)
```

### Integration Testing with Docker

Run the full test suite including integration tests against a real QLever
instance:

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

- [QLever](https://github.com/ad-freiburg/qlever) -- High-performance SPARQL engine (University of Freiburg)
- [QLever Documentation](https://docs.qlever.dev/) -- Setup guides and API reference
- [Model Context Protocol](https://modelcontextprotocol.io) -- MCP specification
- [GitHub Issues](https://github.com/XORwell/mcp-server-qlever/issues) -- Bug reports and feature requests
