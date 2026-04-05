# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-05

### Added

- `format-helpers.ts` — shared sanitization and formatting module
- `escapeSparqlString()` — escapes `\ " \n \r \t` for safe SPARQL literal interpolation
- `sanitizeIri()` — validates IRIs against RFC 3987, rejects `<>"{}|\^` `` ` `` and control characters
- `PREDICATE_REGEX` — strict validation for prefixed names and full IRI predicates
- `analyzeQuery()` method on `QleverClient` (replaces private field access)
- `endpoint` public getter on `QleverClient`
- `timeout` parameter on `get_predicates` tool
- Dockerfile and `.dockerignore` for GHCR container image
- GitHub Actions CI (Node 18/20/22) and Docker publish workflow
- E2E test suite (29 tests) over real MCP stdio transport against live QLever
- GND integration tests (14 tests) against German National Library authority data
- `test:e2e` and `test:ci:gnd` npm scripts
- `scripts/jsonld-to-nt.py` — streaming JSON-LD to N-Triples converter
- `docker-compose.gnd.yml` — QLever setup for GND Werk dataset

### Fixed

- **SPARQL injection in `search_entities`** — incomplete escaping (only `"`, missing `\ \n \r \t`)
- **SPARQL injection in `search_fulltext`** — same incomplete escaping of `keywords` parameter
- **IRI injection in `describe_entity`** — no validation of IRI content, unclosed `<` accepted
- **IRI injection in `spatial_query` and `search_fulltext`** — `type_filter` stripped `<>` but didn't validate content
- **Private field access in `analyze_query`** — bypassed `baseHeaders()`, reimplemented auth inline
- **`getIndexStats()` key mismatch** — QLever returns `num-triples-normal` but interface expected `numTriples`; now normalizes with `Number()` coercion
- **`update()` undefined error** — `parsed.exception` passed as `undefined` to `QleverError`
- **`autocomplete()` URL construction** — fragile regex replaced with explicit path append
- **Dangerous operation regex** — broadened from `DROP/CLEAR ALL` to include `DEFAULT` and `NAMED`
- **`it.skipIf(!available)` vitest bug** — evaluated before `beforeAll`, silently skipping all integration tests
- **Tab injection in `formatResultAsText`** — tabs in cell values now escaped
- Unused `QleverError` imports in `tools.ts` and `advanced-tools.ts`
- Dead `containerSuite()` export in test helpers
- `_:x` blank node in valid-predicate test (replaced with `ns_:prop`)

### Changed

- Extracted `formatResultAsText` and `errorText` from both tool files into `format-helpers.ts`
- `label_predicate` regex tightened: rejects whitespace, backslash, control chars inside `<...>`
- Mock server (`mockStatsResult`) now returns real QLever kebab-case keys
- `QleverClient.endpoint` changed from `private` to public getter
- Internal `fetch()` method renamed to `fetchUrl()` to avoid shadowing global

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
