/**
 * Integration tests against a real QLever container.
 *
 * Requires: docker compose -f docker-compose.test.yml up -d --wait
 * Skipped automatically if the container is not running.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { QleverClient } from "../../src/qlever-client.js";
import { registerTools } from "../../src/tools.js";
import { containerSuite, createTestClient, ENTITIES } from "../helpers.js";

let available = false;
let client: QleverClient;
let mcpClient: Client;

beforeAll(async () => {
  available = await containerSuite();
  if (!available) return;

  client = createTestClient();

  const mcpServer = new McpServer({ name: "integration-test", version: "0.0.1" });
  registerTools(mcpServer, client);

  mcpClient = new Client({ name: "integration-client", version: "0.0.1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(st);
  await mcpClient.connect(ct);
});

function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

// ---------------------------------------------------------------------------
// QleverClient against real container
// ---------------------------------------------------------------------------

describe("Integration: QleverClient", () => {
  it.skipIf(!available)("retrieves index stats with positive counts", async () => {
    const stats = await client.getIndexStats();
    expect(stats.numTriples).toBeGreaterThan(0);
    expect(stats.numPredicates).toBeGreaterThan(0);
    expect(stats.numSubjects).toBeGreaterThan(0);
    expect(stats.numObjects).toBeGreaterThan(0);
  });

  it.skipIf(!available)("executes a simple SELECT query", async () => {
    const result = await client.query(
      "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5",
    );
    expect(result.status).toBe("OK");
    expect(result.res.length).toBeGreaterThan(0);
    expect(result.res.length).toBeLessThanOrEqual(5);
    expect(result.selected).toEqual(["?s", "?p", "?o"]);
  });

  it.skipIf(!available)("finds Einstein by label in the test dataset", async () => {
    const result = await client.query(`
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?label WHERE {
        <${ENTITIES.EINSTEIN}> rdfs:label ?label .
      }
    `);
    expect(result.status).toBe("OK");
    expect(result.res.length).toBe(1);
    expect(result.res[0][0]).toContain("Albert Einstein");
  });

  it.skipIf(!available)("throws QleverError on invalid SPARQL", async () => {
    await expect(
      client.query("THIS IS NOT SPARQL"),
    ).rejects.toThrow();
  });

  it.skipIf(!available)("counts all triples in the dataset", async () => {
    const result = await client.query(
      "SELECT (COUNT(*) AS ?count) WHERE { ?s ?p ?o }",
    );
    expect(result.status).toBe("OK");
    const count = parseInt(result.res[0][0], 10);
    // Test dataset has scientists with multiple properties
    expect(count).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// MCP Tools against real container
// ---------------------------------------------------------------------------

describe("Integration: MCP Tools", () => {
  it.skipIf(!available)("sparql_query returns formatted text with headers and footer", async () => {
    const result = await mcpClient.callTool({
      name: "sparql_query",
      arguments: { query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 3" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("?s");
    expect(text).toContain("?p");
    expect(text).toContain("?o");
    expect(text).toContain("Showing");
  });

  it.skipIf(!available)("sparql_query_json returns parseable JSON with OK status", async () => {
    const result = await mcpClient.callTool({
      name: "sparql_query_json",
      arguments: { query: "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result));
    expect(parsed.status).toBe("OK");
    expect(parsed.res).toBeDefined();
    expect(Array.isArray(parsed.res)).toBe(true);
  });

  it.skipIf(!available)("get_index_stats returns dataset info with triple count", async () => {
    const result = await mcpClient.callTool({
      name: "get_index_stats",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const stats = JSON.parse(getText(result));
    expect(stats.numTriples).toBeGreaterThan(0);
    expect(stats.numPredicates).toBeGreaterThan(0);
  });

  it.skipIf(!available)("describe_entity returns Einstein's outgoing properties", async () => {
    const result = await mcpClient.callTool({
      name: "describe_entity",
      arguments: { iri: ENTITIES.EINSTEIN },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Outgoing properties");
    expect(text).toContain("Incoming references");
    // Should contain data about Einstein
    expect(text).toContain("Albert Einstein");
  });

  it.skipIf(!available)("search_entities finds Curie by name", async () => {
    const result = await mcpClient.callTool({
      name: "search_entities",
      arguments: { search_term: "Curie" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Marie_Curie");
  });

  it.skipIf(!available)("get_predicates lists dataset predicates with counts", async () => {
    const result = await mcpClient.callTool({
      name: "get_predicates",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("?predicate");
    expect(text).toContain("?count");
    // Should contain at least rdf:type and rdfs:label
    expect(text).toContain("type");
    expect(text).toContain("label");
  });
});
