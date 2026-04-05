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
- Input sanitization: IRI validation and SPARQL injection prevention
- Works with any QLever instance (local Docker, self-hosted, or public)

## Quick Start

Pick your scenario:

### A) You already have a QLever endpoint

```bash
claude mcp add qlever -- npx -y mcp-server-qlever -e http://your-qlever:7019
```

Done. Claude can now query your knowledge graph.

### B) You want everything from scratch (QLever + MCP)

```bash
docker compose -f docker-compose.allinone.yml up -d --wait
claude mcp add qlever -- npx -y mcp-server-qlever -e http://localhost:7019
```

This starts QLever with a small test dataset and connects the MCP server to it.

### C) You want real-world data (e.g. German National Library)

```bash
cd examples/gnd
docker compose up -d --wait
claude mcp add gnd -- npx -y mcp-server-qlever -e http://localhost:7020
```

First run downloads and indexes the GND Werk authority data (~90 MB, ~3.5M triples) automatically.
See [`examples/gnd/`](examples/gnd/) for details.

## Installation

There are several ways to install and run the server. Pick whichever fits your setup.

### npx (no install)

```bash
npx mcp-server-qlever --endpoint http://localhost:7019
```

### npm (global)

```bash
npm install -g mcp-server-qlever
mcp-server-qlever --endpoint http://localhost:7019
```

### Docker

```bash
docker run --rm -i ghcr.io/xorwell/mcp-server-qlever:latest \
  --endpoint http://host.docker.internal:7019
```

Use `--network=host` on Linux to reach a QLever instance on localhost:

```bash
docker run --rm -i --network=host ghcr.io/xorwell/mcp-server-qlever:latest \
  --endpoint http://localhost:7019
```

Environment variables work too:

```bash
docker run --rm -i --network=host \
  -e QLEVER_ENDPOINT=http://localhost:7019 \
  -e QLEVER_ACCESS_TOKEN=my-token \
  ghcr.io/xorwell/mcp-server-qlever:latest
```

### From source

```bash
git clone https://github.com/XORwell/mcp-server-qlever.git
cd mcp-server-qlever
npm install
npm run build
node dist/index.js --endpoint http://localhost:7019
```

**Requirements:** Node.js 18+ (all methods), or Docker/Podman (Docker method).

## Configuration

### Claude Code (CLI)

```bash
# Project-scoped
claude mcp add qlever -- npx -y mcp-server-qlever --endpoint http://localhost:7019

# User-scoped (all projects)
claude mcp add -s user qlever -- npx -y mcp-server-qlever --endpoint http://localhost:7019
```

Using the Docker image instead of npx:

```bash
claude mcp add qlever -- docker run --rm -i --network=host \
  ghcr.io/xorwell/mcp-server-qlever:latest --endpoint http://localhost:7019
```

Verify:

```bash
claude mcp list
```

### Claude Code (VS Code / Cursor)

Edit `.vscode/settings.json`:

```jsonc
{
  "claude-code.mcpServers": {
    "qlever": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "--endpoint", "http://localhost:7019"]
    }
  }
}
```

Or with Docker:

```jsonc
{
  "claude-code.mcpServers": {
    "qlever": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i", "--network=host",
        "ghcr.io/xorwell/mcp-server-qlever:latest",
        "--endpoint", "http://localhost:7019"
      ]
    }
  }
}
```

### Manual configuration (any MCP client)

Add to `~/.claude.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "qlever": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "--endpoint", "http://localhost:7019"]
    }
  }
}
```

With access token via env:

```json
{
  "mcpServers": {
    "qlever": {
      "command": "npx",
      "args": ["-y", "mcp-server-qlever", "--endpoint", "http://localhost:7019"],
      "env": {
        "QLEVER_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Multiple endpoints

Register several QLever instances under different names:

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

## Tool Reference

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `sparql_query` | Execute SPARQL and get formatted text results | `query`, `timeout`, `max_rows` |
| `sparql_query_json` | Execute SPARQL and get raw JSON response | `query`, `timeout`, `max_rows` |
| `get_index_stats` | Retrieve dataset metadata (triple count, predicates, etc.) | -- |
| `describe_entity` | Look up all triples for an entity by IRI | `iri`, `limit` |
| `search_entities` | Full-text search for entities by label | `search_term`, `label_predicate`, `limit` |
| `get_predicates` | List available predicates ordered by frequency | `limit`, `timeout` |
| `sparql_autocomplete` | Context-sensitive autocompletion using QLever's /ac endpoint | `partial_query`, `context`, `entity_name`, `limit` |
| `analyze_query` | Get query execution plan without running the query | `query` |
| `list_named_graphs` | List all named graphs with triple counts | `limit` |
| `search_fulltext` | Search QLever's text index for entity-keyword co-occurrence | `keywords`, `filter_type`, `limit` |
| `spatial_query` | Geographic search (radius or bounding box) via spatial join | `mode`, `lat`, `lon`, `radius_km` / bbox params, `limit` |
| `sparql_update` | Execute SPARQL 1.1 Update (requires access token) | `update`, `graph_uri`, `dry_run`, `confirm` |

## Prompts

| Prompt | Description |
|--------|-------------|
| `explore_dataset` | Step-by-step workflow for discovering an unknown QLever dataset |
| `safe_update_workflow` | Validated workflow for SPARQL Update operations with dry-run preview |

## QLever-Specific Features

This server goes beyond generic SPARQL access by exposing QLever's unique capabilities:

- **Context-sensitive autocompletion** -- The `sparql_autocomplete` tool uses QLever's `/ac` endpoint to suggest completions based on what actually exists in the index.
- **Query plan analysis** -- The `analyze_query` tool returns QLever's internal query plan with estimated result sizes, helping predict performance before execution.
- **Full-text search** -- The `search_fulltext` tool uses QLever's SPARQL+Text extension to find entities co-occurring with keywords in the text corpus.
- **Spatial queries** -- The `spatial_query` tool uses QLever's native spatial join for efficient geographic searches.
- **Safe SPARQL Update** -- The `sparql_update` tool includes dry-run preview, destructive operation detection (`DROP/CLEAR ALL|DEFAULT|NAMED`), and access token enforcement.

## Security

All user-controlled inputs are sanitized before interpolation into SPARQL:

- **String literals** are escaped for `\ " \n \r \t` to prevent SPARQL injection
- **IRIs** are validated against RFC 3987 (rejects `<>"{}|\^` `` ` `` and control characters)
- **Predicates** are validated with a strict regex matching prefixed names or safe full IRIs
- **SPARQL Update** requires explicit access token and flags destructive operations

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

## Running QLever with Docker

QLever requires a two-step process: build an index from RDF data, then serve it.

### Preconfigured dataset

```bash
docker run -it --name qlever-wikidata -p 7019:7019 adfreiburg/qlever:latest bash

# Inside the container:
qlever setup-config wikidata    # or: olympics, dblp, osm-planet, uniprot, ...
qlever get-data                 # downloads the dataset
qlever index                    # builds the index (may take minutes to hours)
qlever start                    # starts the SPARQL server on port 7019
```

### Custom RDF data

```bash
docker run -it --name qlever-custom -p 7019:7019 \
  -v /path/to/your/data:/data \
  adfreiburg/qlever:latest bash

# Inside the container:
qlever-index -i /data/myindex -f /data/mydata.nt -F nt -s /data/settings.json
qlever-server -i /data/myindex -p 7019 -m 4GB
```

See the [QLever documentation](https://docs.qlever.dev/) for details on dataset
configuration, index settings, and performance tuning.

## Examples

The [`examples/`](examples/) directory contains ready-to-use setups for specific datasets:

| Example | Dataset | Triples | Setup |
|---------|---------|---------|-------|
| [`examples/gnd/`](examples/gnd/) | GND Werk (Deutsche Nationalbibliothek) | ~3.5M | `cd examples/gnd && docker compose up` |

Each example includes a `docker-compose.yml` that downloads, converts, and indexes the data
automatically on first run. Subsequent starts are instant (index persisted in Docker volume).

Want to add your own dataset? Copy any example directory and adjust the data source URL.

## Development

```bash
git clone https://github.com/XORwell/mcp-server-qlever.git
cd mcp-server-qlever
npm install
npm run build
```

### Testing

The project has 336 tests across three layers:

```bash
# Unit tests only (no Docker needed)
npm run test:unit

# Integration tests against real QLever (scientists dataset)
docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration
docker compose -f docker-compose.test.yml down -v

# E2E tests over real MCP stdio transport (GND dataset, 390K triples)
# First, generate the test fixture from DNB open data:
pip install ijson
curl -o /tmp/gnd-werk.jsonld.gz https://data.dnb.de/opendata/authorities-gnd-werk_lds_20260217.jsonld.gz
python3 scripts/jsonld-to-nt.py -i /tmp/gnd-werk.jsonld.gz --limit 50000 > test/fixtures/gnd/gnd-werk-sample.nt
docker compose -f docker-compose.gnd.yml up -d --wait
npm run build
npm run test:e2e
docker compose -f docker-compose.gnd.yml down -v

# Everything at once
npm run test:ci       # unit + integration (scientists)
npm run test:ci:gnd   # all tests including E2E (GND)
```

| Layer | Tests | What it covers |
|-------|-------|----------------|
| Unit | 282 | All tools, client, security (SPARQL injection, IRI validation, bounds, timeouts) |
| Integration | 25 | Real QLever queries against scientists and GND authority data |
| E2E | 29 | Real MCP server process over stdio, all 12 tools + 2 prompts against live QLever |

### Building the Docker image

```bash
docker build -t mcp-server-qlever:local .
docker run --rm mcp-server-qlever:local --help
```

## License

[MIT](LICENSE)

## Links

- [QLever](https://github.com/ad-freiburg/qlever) -- High-performance SPARQL engine (University of Freiburg)
- [QLever Documentation](https://docs.qlever.dev/) -- Setup guides and API reference
- [Model Context Protocol](https://modelcontextprotocol.io) -- MCP specification
- [GitHub Issues](https://github.com/XORwell/mcp-server-qlever/issues) -- Bug reports and feature requests
