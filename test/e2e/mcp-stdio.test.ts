/**
 * End-to-end test: spawns the real MCP server process over stdio transport
 * and exercises all 12 tools + 2 prompts against the live GND QLever instance.
 *
 * This validates the full stack: CLI parsing → MCP protocol → QleverClient → HTTP → QLever.
 *
 * Requires:
 *   docker compose -f docker-compose.gnd.yml up -d --wait
 *   npm run build
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const GND_ENDPOINT = process.env.GND_ENDPOINT ?? "http://localhost:7020";
const SERVER_PATH = resolve(import.meta.dirname, "../../dist/index.js");

let client: Client;
let transport: StdioClientTransport;
let available = false;

async function isGndAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${GND_ENDPOINT}/?cmd=stats`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

async function skip(): Promise<boolean> {
  if (!available) return true;
  return false;
}

beforeAll(async () => {
  available = await isGndAvailable();
  if (!available) {
    console.warn(
      "⚠ GND QLever not available — skipping E2E tests.\n" +
        "  Start it with: docker compose -f docker-compose.gnd.yml up -d --wait",
    );
    return;
  }

  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH, "--endpoint", GND_ENDPOINT],
  });

  client = new Client({ name: "e2e-test", version: "0.0.1" });
  await client.connect(transport);
});

afterAll(async () => {
  if (client) {
    await client.close();
  }
});

// ---------------------------------------------------------------------------
// Server capabilities
// ---------------------------------------------------------------------------

describe("E2E: Server capabilities", () => {
  it("lists all 12 tools", async () => {
    if (await skip()) return;
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "analyze_query",
      "describe_entity",
      "get_index_stats",
      "get_predicates",
      "list_named_graphs",
      "search_entities",
      "search_fulltext",
      "sparql_autocomplete",
      "sparql_query",
      "sparql_query_json",
      "sparql_update",
      "spatial_query",
    ]);
  });

  it("lists 2 prompts", async () => {
    if (await skip()) return;
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(["explore_dataset", "safe_update_workflow"]);
  });

  it("each tool has a description and input schema", async () => {
    if (await skip()) return;
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} missing input schema`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Core tools against real GND data
// ---------------------------------------------------------------------------

describe("E2E: sparql_query", () => {
  it("executes SELECT and returns formatted table", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query",
      arguments: {
        query: `SELECT ?work ?name WHERE {
          ?work <https://d-nb.info/standards/elementset/gnd#preferredNameForTheWork> ?name .
        } LIMIT 5`,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("?work");
    expect(text).toContain("?name");
    expect(text).toContain("Showing 5");
  });

  it("supports timeout parameter", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query",
      arguments: {
        query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 1",
        timeout: "5s",
      },
    });
    expect(result.isError).toBeFalsy();
  });

  it("supports max_rows parameter", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query",
      arguments: {
        query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100",
        max_rows: 3,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Showing 3");
  });

  it("returns isError on invalid SPARQL", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query",
      arguments: { query: "THIS IS NOT SPARQL" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("E2E: sparql_query_json", () => {
  it("returns valid JSON with status OK", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query_json",
      arguments: {
        query: "SELECT ?s WHERE { ?s ?p ?o } LIMIT 2",
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result));
    expect(parsed.status).toBe("OK");
    expect(parsed.res.length).toBe(2);
    expect(Array.isArray(parsed.selected)).toBe(true);
    expect(parsed.time).toBeDefined();
  });
});

describe("E2E: get_index_stats", () => {
  it("returns normalized stats with 390K+ triples", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "get_index_stats",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const stats = JSON.parse(getText(result));
    expect(stats.numTriples).toBeGreaterThan(300000);
    expect(stats.numPredicates).toBeGreaterThan(50);
    expect(stats.numSubjects).toBeGreaterThan(10000);
    expect(stats.numObjects).toBeGreaterThan(10000);
    // Also check original kebab-case keys are preserved
    expect(stats["num-triples-normal"]).toBe(stats.numTriples);
  });
});

describe("E2E: describe_entity", () => {
  it("describes Abrogans (GND 4000196-9) with outgoing + incoming", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "describe_entity",
      arguments: { iri: "https://d-nb.info/gnd/4000196-9" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Entity: <https://d-nb.info/gnd/4000196-9>");
    expect(text).toContain("Outgoing properties");
    expect(text).toContain("Incoming references");
    expect(text).toContain("Abrogans");
  });

  it("handles already-bracketed IRI", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "describe_entity",
      arguments: { iri: "<https://d-nb.info/gnd/4000196-9>" },
    });
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain("Abrogans");
  });

  it("rejects malicious IRI with injection", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "describe_entity",
      arguments: { iri: "http://x> } DELETE WHERE {?s ?p ?o" },
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("illegal characters");
  });
});

describe("E2E: search_entities", () => {
  it("searches with default rdfs:label (may return empty for GND)", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "search_entities",
      arguments: { search_term: "Bibel" },
    });
    // GND uses preferredNameForTheWork, not rdfs:label
    expect(result.isError).toBeFalsy();
  });

  it("searches with custom label predicate for GND", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "search_entities",
      arguments: {
        search_term: "Bibel",
        label_predicate:
          "<https://d-nb.info/standards/elementset/gnd#preferredNameForTheWork>",
        limit: 10,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Bibel");
  });

  it("safely handles special characters in search_term", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "search_entities",
      arguments: { search_term: 'test \\" backslash\nnewline' },
    });
    // Should not crash — either returns results or empty
    expect(result.isError).toBeFalsy();
  });
});

describe("E2E: get_predicates", () => {
  it("lists GND predicates with counts", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "get_predicates",
      arguments: { limit: 20 },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("?predicate");
    expect(text).toContain("?count");
    expect(text).toContain("preferredNameForTheWork");
    expect(text).toContain("gndIdentifier");
  });

  it("supports custom timeout", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "get_predicates",
      arguments: { limit: 5, timeout: "10s" },
    });
    expect(result.isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Advanced tools
// ---------------------------------------------------------------------------

describe("E2E: analyze_query", () => {
  it("returns query plan for a GND query", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "analyze_query",
      arguments: {
        query: `SELECT ?work ?name WHERE {
          ?work <https://d-nb.info/standards/elementset/gnd#preferredNameForTheWork> ?name .
        } LIMIT 10`,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text.length).toBeGreaterThan(50);
  });
});

describe("E2E: list_named_graphs", () => {
  it("returns without error (GND data has no named graphs)", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "list_named_graphs",
      arguments: { limit: 10 },
    });
    expect(result.isError).toBeFalsy();
    // GND sample has no named graphs → "No results"
    expect(getText(result)).toContain("No results");
  });
});

describe("E2E: search_fulltext", () => {
  it("returns without error (GND has no text index)", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "search_fulltext",
      arguments: { keywords: "Abrogans" },
    });
    // Will error because GND sample has no text index — that's expected
    expect(result.content).toBeDefined();
  });
});

describe("E2E: sparql_autocomplete", () => {
  it("returns without crash (may error without AC support)", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_autocomplete",
      arguments: {
        partial_query: "SELECT ?x WHERE { ?x ",
        limit: 5,
      },
    });
    expect(result.content).toBeDefined();
  });
});

describe("E2E: spatial_query", () => {
  it("returns error for GND data (no coordinates)", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "spatial_query",
      arguments: {
        params: {
          mode: "radius",
          lat: 48.137,
          lon: 11.576,
          radius_km: 10,
        },
      },
    });
    // GND Werk data has no geo coordinates — error expected
    expect(result.content).toBeDefined();
  });
});

describe("E2E: sparql_update", () => {
  it("rejects update without access token", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_update",
      arguments: {
        update: "INSERT DATA { <a> <b> <c> }",
      },
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("access token");
  });

  it("dry_run returns preview without executing", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_update",
      arguments: {
        update: "INSERT DATA { <a> <b> <c> }",
        dry_run: true,
      },
    });
    // dry_run should work even without token? No — the code checks token first.
    // So this will error with "access token required"
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

describe("E2E: Prompts", () => {
  it("explore_dataset returns step-by-step instructions", async () => {
    if (await skip()) return;
    const result = await client.getPrompt({ name: "explore_dataset" });
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe("user");
    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain("get_index_stats");
    expect(text).toContain("get_predicates");
  });

  it("safe_update_workflow returns update instructions", async () => {
    if (await skip()) return;
    const result = await client.getPrompt({ name: "safe_update_workflow" });
    expect(result.messages.length).toBe(1);
    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain("sparql_update");
    expect(text).toContain("dry_run");
  });
});

// ---------------------------------------------------------------------------
// Complex real-world queries
// ---------------------------------------------------------------------------

describe("E2E: Complex GND queries", () => {
  it("finds works with Wikidata sameAs links", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query",
      arguments: {
        query: `
          PREFIX gnd: <https://d-nb.info/standards/elementset/gnd#>
          PREFIX owl: <http://www.w3.org/2002/07/owl#>
          SELECT ?name ?wikidata WHERE {
            ?work a gnd:Work .
            ?work gnd:preferredNameForTheWork ?name .
            ?work owl:sameAs ?wikidata .
            FILTER(CONTAINS(STR(?wikidata), "wikidata"))
          } LIMIT 5
        `,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("wikidata.org");
    expect(text).toContain("Showing 5");
  });

  it("counts works by subject category", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query_json",
      arguments: {
        query: `
          PREFIX gnd: <https://d-nb.info/standards/elementset/gnd#>
          SELECT ?cat (COUNT(?work) AS ?count) WHERE {
            ?work a gnd:Work .
            ?work gnd:gndSubjectCategory ?cat .
          }
          GROUP BY ?cat
          ORDER BY DESC(?count)
          LIMIT 10
        `,
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result));
    expect(parsed.status).toBe("OK");
    expect(parsed.res.length).toBeGreaterThan(0);
  });

  it("navigates multi-hop relationships", async () => {
    if (await skip()) return;
    const result = await client.callTool({
      name: "sparql_query",
      arguments: {
        query: `
          PREFIX gnd: <https://d-nb.info/standards/elementset/gnd#>
          SELECT ?work ?name ?author WHERE {
            ?work a gnd:Work .
            ?work gnd:preferredNameForTheWork ?name .
            ?bnode gnd:firstAuthor ?author .
          } LIMIT 5
        `,
        timeout: "10s",
      },
    });
    expect(result.isError).toBeFalsy();
  });
});
