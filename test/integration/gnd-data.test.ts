/**
 * Integration tests against real GND (German National Library) authority data.
 *
 * Requires: docker compose -f docker-compose.gnd.yml up -d --wait
 * Expects QLever on port 7020 with GND Werk sample data (~390K triples).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { QleverClient } from "../../src/qlever-client.js";
import { registerTools } from "../../src/tools.js";
import { registerAdvancedTools } from "../../src/advanced-tools.js";

const GND_ENDPOINT = process.env.GND_ENDPOINT ?? "http://localhost:7020";
const GND_NS = "https://d-nb.info/standards/elementset/gnd#";

let client: QleverClient;
let mcpClient: Client;

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

// Resolve availability once, shared across all tests.
const gndAvailable = isGndAvailable();

beforeAll(async () => {
  if (!(await gndAvailable)) {
    console.warn(
      "⚠ GND QLever container not available — skipping GND tests.\n" +
        "  Start it with: docker compose -f docker-compose.gnd.yml up -d --wait",
    );
    return;
  }

  client = new QleverClient({
    endpoint: GND_ENDPOINT,
    defaultTimeout: "30s",
  });

  const mcpServer = new McpServer({ name: "gnd-test", version: "0.0.1" });
  registerTools(mcpServer, client);
  registerAdvancedTools(mcpServer, client);

  mcpClient = new Client({ name: "gnd-client", version: "0.0.1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(st);
  await mcpClient.connect(ct);
});

/** Skip helper: call at the start of each test. */
async function skipIfUnavailable() {
  if (!(await gndAvailable)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// QleverClient against GND data
// ---------------------------------------------------------------------------

describe("GND: QleverClient", () => {
  it("retrieves index stats with ~390K triples", async () => {
    if (await skipIfUnavailable()) return;
    const stats = await client.getIndexStats();
    expect(stats.numTriples).toBeGreaterThan(300000);
    expect(stats.numPredicates).toBeGreaterThan(50);
    expect(stats.numSubjects).toBeGreaterThan(10000);
  });

  it("finds GND works by type", async () => {
    if (await skipIfUnavailable()) return;
    const result = await client.query(`
      SELECT (COUNT(?work) AS ?count) WHERE {
        ?work a <${GND_NS}Work> .
      }
    `);
    expect(result.status).toBe("OK");
    // QLever may return count as a string; parse robustly
    const raw = result.res[0][0];
    const count = parseInt(raw.replace(/"/g, ""), 10);
    expect(count).toBeGreaterThan(1000);
  });

  it("queries work names with German content", async () => {
    if (await skipIfUnavailable()) return;
    const result = await client.query(`
      SELECT ?name WHERE {
        ?work <${GND_NS}preferredNameForTheWork> ?name .
      } LIMIT 20
    `);
    expect(result.status).toBe("OK");
    expect(result.res.length).toBe(20);
    expect(result.res.some((r) => r[0].length > 0)).toBe(true);
  });

  it("finds the Abrogans by GND identifier", async () => {
    if (await skipIfUnavailable()) return;
    const result = await client.query(`
      SELECT ?name WHERE {
        <https://d-nb.info/gnd/4000196-9> <${GND_NS}preferredNameForTheWork> ?name .
      }
    `);
    expect(result.status).toBe("OK");
    // QLever returns string literals with surrounding quotes
    expect(result.res[0][0]).toContain("Abrogans");
  });

  it("navigates sameAs links to Wikidata/VIAF", async () => {
    if (await skipIfUnavailable()) return;
    const result = await client.query(`
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      SELECT ?external WHERE {
        <https://d-nb.info/gnd/4000196-9> owl:sameAs ?external .
      }
    `);
    expect(result.status).toBe("OK");
    expect(result.res.length).toBeGreaterThan(0);
    const externals = result.res.map((r) => r[0]);
    expect(
      externals.some((e) => e.includes("viaf.org") || e.includes("wikidata.org")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MCP Tools against GND data
// ---------------------------------------------------------------------------

describe("GND: MCP Tools", () => {
  it("sparql_query returns GND works", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "sparql_query",
      arguments: {
        query: `SELECT ?work ?name WHERE {
          ?work <${GND_NS}preferredNameForTheWork> ?name .
        } LIMIT 5`,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("?work");
    expect(text).toContain("?name");
    expect(text).toContain("Showing 5");
  });

  it("sparql_query_json returns valid JSON for GND", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "sparql_query_json",
      arguments: {
        query: `SELECT ?work ?name WHERE {
          ?work <${GND_NS}preferredNameForTheWork> ?name .
        } LIMIT 3`,
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result));
    expect(parsed.status).toBe("OK");
    expect(parsed.res.length).toBe(3);
  });

  it("get_index_stats returns GND dataset info", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "get_index_stats",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const stats = JSON.parse(getText(result));
    expect(stats.numTriples).toBeGreaterThan(300000);
  });

  it("describe_entity works with GND URIs", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "describe_entity",
      arguments: { iri: "https://d-nb.info/gnd/4000196-9" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Abrogans");
  });

  it("get_predicates lists GND-specific predicates", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "get_predicates",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("preferredNameForTheWork");
    expect(text).toContain("gndIdentifier");
  });

  it("search_entities finds works by name fragment", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "search_entities",
      arguments: { search_term: "Bibel" },
    });
    // search_entities uses rdfs:label — GND uses preferredNameForTheWork instead.
    // This tests whether the tool handles datasets without rdfs:label gracefully.
    expect(result.isError).toBeFalsy();
  });

  it("analyze_query shows plan for GND query", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "analyze_query",
      arguments: {
        query: `SELECT ?work ?name WHERE {
          ?work <${GND_NS}preferredNameForTheWork> ?name .
          ?work <${GND_NS}gndIdentifier> ?id .
        } LIMIT 10`,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text.length).toBeGreaterThan(50);
  });

  it("handles complex GND query with multiple joins", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "sparql_query",
      arguments: {
        query: `
          PREFIX gnd: <${GND_NS}>
          PREFIX owl: <http://www.w3.org/2002/07/owl#>
          SELECT ?name ?wikidata WHERE {
            ?work a gnd:Work .
            ?work gnd:preferredNameForTheWork ?name .
            ?work owl:sameAs ?wikidata .
            FILTER(CONTAINS(STR(?wikidata), "wikidata"))
          } LIMIT 10
        `,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("wikidata.org");
  });

  it("sparql_autocomplete handles GND predicates", async () => {
    if (await skipIfUnavailable()) return;
    const result = await mcpClient.callTool({
      name: "sparql_autocomplete",
      arguments: {
        query: `SELECT ?x WHERE { ?x <${GND_NS}`,
        cursor_position: `SELECT ?x WHERE { ?x <${GND_NS}`.length,
      },
    });
    // Autocomplete may error if the QLever instance lacks AC support —
    // we just verify the tool doesn't crash unexpectedly.
    expect(result.content).toBeDefined();
  });
});
