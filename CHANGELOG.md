# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-25

### Added

- **sparql_autocomplete** tool — context-sensitive SPARQL autocompletion using QLever's /ac endpoint
- **analyze_query** tool — query plan analysis without execution
- **list_named_graphs** tool — enumerate named graphs with triple counts
- **search_fulltext** tool — QLever text index search for entity-keyword co-occurrence
- **spatial_query** tool — geographic search with radius and bounding box modes
- **sparql_update** tool — SPARQL 1.1 Update with dry-run preview and safety guards
- **explore_dataset** MCP prompt — guided dataset exploration workflow
- **safe_update_workflow** MCP prompt — validated SPARQL Update workflow
- Security tests for input validation and injection prevention

### Fixed

- SPARQL injection vulnerability in `search_entities` via `label_predicate` parameter
- HTTP error handling logic (`!res.ok` check was tautological)
- Missing upper bounds on numeric parameters (limit, max_rows)
- Timeout format validation (now enforces QLever duration syntax)
- Null-safe handling of QLever error responses without exception field

### Changed

- Minimum `label_predicate` values validated against safe predicate pattern (prefixed name or full IRI)
- All numeric limits capped at sensible maximums (1000-10000 depending on tool)

## [0.1.0] - 2026-03-25

### Added

- Initial release with 6 core MCP tools
- `sparql_query` — formatted text results
- `sparql_query_json` — raw JSON results
- `get_index_stats` — dataset metadata
- `describe_entity` — entity IRI lookup
- `search_entities` — label-based entity search
- `get_predicates` — predicate frequency listing
- Docker Compose test environment with QLever container
- 51 unit tests, 11 integration tests
