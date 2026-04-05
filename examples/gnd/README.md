# GND Werk — QLever + MCP Server

Fully automated setup for querying the [GND](https://www.dnb.de/EN/Professionell/Standardisierung/GND/gnd_node.html)
(Gemeinsame Normdatei / Integrated Authority File) Werk authority data from the
Deutsche Nationalbibliothek via SPARQL.

## What you get

- ~3.5 million triples of German library authority data (works, authors, subjects)
- QLever SPARQL endpoint on `http://localhost:7020`
- Ready to connect with Claude Code or any MCP client

## Quick start

```bash
# Start QLever with GND data (first run: ~5 min for download + indexing)
docker compose up -d --wait

# Connect Claude Code
claude mcp add gnd -- npx -y mcp-server-qlever -e http://localhost:7020
```

Or just tell Claude: *"Set up the QLever MCP server on http://localhost:7020"* — it knows how.

## What happens on first run

1. Downloads the GND Werk dump from `data.dnb.de` (~90 MB, CC0 license)
2. Converts JSON-LD to N-Triples inside the container
3. Builds the QLever index
4. Starts the SPARQL server

The index is persisted in a Docker volume — subsequent starts take seconds.

## Example queries

Once connected, ask Claude things like:

- *"What works are in the GND dataset? Show me some with their names."*
- *"Find all works linked to Wikidata."*
- *"What predicates are available in this dataset?"*
- *"Describe the entity https://d-nb.info/gnd/4000196-9"*
- *"Search for works containing 'Bibel' in their name"*

## Stop / Reset

```bash
# Stop (keeps index)
docker compose down

# Full reset (re-downloads + re-indexes on next start)
docker compose down -v
```

## Data source

- **Provider**: Deutsche Nationalbibliothek (DNB)
- **Dataset**: GND Werk authority records
- **License**: CC0 (public domain)
- **URL**: https://data.dnb.de/opendata/
