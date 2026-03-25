/**
 * Unit tests for MCP tools.
 *
 * Tests each tool's behavior using a mock QLever backend.
 * Validates input handling, output formatting, and error propagation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { QleverClient } from "../../src/qlever-client.js";
import { registerTools } from "../../src/tools.js";
import {
  MockQleverServer,
  mockQueryResult,
  mockErrorResult,
  mockStatsResult,
  type MockResponse,
} from "../mock-server.js";

/** Extract the text from a callTool result. */
function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe("MCP Tools", () => {
  let mock: MockQleverServer;
  let mcpClient: Client;
  let mcpServer: McpServer;

  // Default handler routes by request content
  const defaultHandler = (_method: string, url: URL, body: string): MockResponse => {
    const cmd = url.searchParams.get("cmd");

    if (cmd === "stats") {
      return mockStatsResult({
        name: "scientists",
        numTriples: 42,
        numPredicates: 7,
        numSubjects: 9,
        numObjects: 30,
        description: "Test dataset of famous scientists",
      });
    }

    if (cmd === "cache-stats") {
      return { body: { pinnedSize: "0 B", nonPinnedSize: "128 KB" } };
    }

    // Parse query from URL-encoded body
    const params = new URLSearchParams(body);
    const query = params.get("query") ?? "";

    // Route based on query content for predictable test results
    if (query.includes("COUNT") && query.includes("GROUP BY ?predicate")) {
      return mockQueryResult({
        selected: ["?predicate", "?count"],
        res: [
          ["<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>", "9"],
          ["<http://www.w3.org/2000/01/rdf-schema#label>", "9"],
          ["<http://example.org/field>", "7"],
          ["<http://example.org/birthYear>", "5"],
          ["<http://example.org/birthPlace>", "5"],
          ["<http://example.org/knownFor>", "5"],
          ["<http://example.org/award>", "4"],
        ],
        totalResults: 7,
      });
    }

    if (query.includes("CONTAINS") && query.includes("LCASE")) {
      // search_entities query
      if (query.includes("Einstein")) {
        return mockQueryResult({
          selected: ["?entity", "?label"],
          res: [["<http://example.org/Albert_Einstein>", '"Albert Einstein"']],
        });
      }
      if (query.includes("xyz_no_match")) {
        return mockQueryResult({
          selected: ["?entity", "?label"],
          res: [],
          totalResults: 0,
        });
      }
      return mockQueryResult({
        selected: ["?entity", "?label"],
        res: [
          ["<http://example.org/Albert_Einstein>", '"Albert Einstein"'],
          ["<http://example.org/Marie_Curie>", '"Marie Curie"'],
        ],
      });
    }

    if (query.includes("<http://example.org/Albert_Einstein> ?predicate ?object")) {
      return mockQueryResult({
        selected: ["?predicate", "?object"],
        res: [
          ["<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>", "<http://example.org/Scientist>"],
          ["<http://www.w3.org/2000/01/rdf-schema#label>", '"Albert Einstein"'],
          ["<http://example.org/birthYear>", '"1879"'],
          ["<http://example.org/field>", "<http://example.org/Physics>"],
        ],
        totalResults: 7,
      });
    }

    if (query.includes("?subject ?predicate <http://example.org/Albert_Einstein>")) {
      return mockQueryResult({
        selected: ["?subject", "?predicate"],
        res: [],
        totalResults: 0,
      });
    }

    // Default: simple triple pattern result
    return mockQueryResult({
      selected: ["?s", "?p", "?o"],
      res: [
        ["<http://example.org/Albert_Einstein>", "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>", "<http://example.org/Scientist>"],
        ["<http://example.org/Marie_Curie>", "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>", "<http://example.org/Scientist>"],
      ],
      totalResults: 42,
    });
  };

  beforeAll(async () => {
    mock = new MockQleverServer(defaultHandler);
    await mock.start();
  });

  afterAll(async () => {
    await mock.stop();
  });

  beforeEach(async () => {
    mock.setHandler(defaultHandler);

    // Create fresh MCP server + client pair for each test
    const qleverClient = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });
    mcpServer = new McpServer({
      name: "test-qlever",
      version: "0.0.1",
    });
    registerTools(mcpServer, qleverClient);

    mcpClient = new Client({ name: "test-client", version: "0.0.1" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  });

  // -----------------------------------------------------------------------
  // Tool listing
  // -----------------------------------------------------------------------

  describe("tool listing", () => {
    it("registers all 6 expected tools", async () => {
      const { tools } = await mcpClient.listTools();
      const names = tools.map((t) => t.name).sort();

      expect(names).toEqual([
        "describe_entity",
        "get_index_stats",
        "get_predicates",
        "search_entities",
        "sparql_query",
        "sparql_query_json",
      ]);
      expect(tools).toHaveLength(6);
    });

    it("each tool has a description longer than 10 characters", async () => {
      const { tools } = await mcpClient.listTools();
      for (const tool of tools) {
        expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
        expect(
          tool.description!.length,
          `${tool.name} description should be meaningful`,
        ).toBeGreaterThan(10);
      }
    });
  });

  // -----------------------------------------------------------------------
  // sparql_query
  // -----------------------------------------------------------------------

  describe("sparql_query", () => {
    it("executes a query and returns formatted text with headers and rows", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 2" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      // Header row
      expect(text).toContain("?s\t?p\t?o");
      // Data rows
      expect(text).toContain("Albert_Einstein");
      expect(text).toContain("Marie_Curie");
      // Footer with counts
      expect(text).toContain("Showing 2 of 42 results");
    });

    it("passes timeout to the client", async () => {
      let receivedBody = "";
      mock.setHandler((_m, _u, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", timeout: "5s" },
      });

      const params = new URLSearchParams(receivedBody);
      expect(params.get("timeout")).toBe("5s");
    });

    it("passes max_rows as send parameter", async () => {
      let receivedBody = "";
      mock.setHandler((_m, _u, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 50 },
      });

      const params = new URLSearchParams(receivedBody);
      expect(params.get("send")).toBe("50");
    });

    it("returns isError=true with error message on QLever error", async () => {
      mock.setHandler(() => mockErrorResult("Syntax error in SPARQL query"));

      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "INVALID" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("QLever error");
      expect(text).toContain("Syntax error in SPARQL query");
    });

    it("handles empty result set with 'No results' message", async () => {
      mock.setHandler(() =>
        mockQueryResult({ selected: ["?x"], res: [], totalResults: 0 }),
      );

      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("No results");
    });
  });

  // -----------------------------------------------------------------------
  // sparql_query_json
  // -----------------------------------------------------------------------

  describe("sparql_query_json", () => {
    it("returns raw JSON response that can be parsed", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 2" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      const parsed = JSON.parse(text);
      expect(parsed.status).toBe("OK");
      expect(parsed.selected).toEqual(["?s", "?p", "?o"]);
      expect(parsed.res).toHaveLength(2);
      expect(parsed.resultSizeTotal).toBe(42);
      expect(parsed.time).toBeDefined();
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Query timeout"));

      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT * WHERE { ?s ?p ?o }" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Query timeout");
    });
  });

  // -----------------------------------------------------------------------
  // get_index_stats
  // -----------------------------------------------------------------------

  describe("get_index_stats", () => {
    it("returns index metadata as parseable JSON", async () => {
      const result = await mcpClient.callTool({
        name: "get_index_stats",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      const stats = JSON.parse(text);
      expect(stats.name).toBe("scientists");
      expect(stats.numTriples).toBe(42);
      expect(stats.numPredicates).toBe(7);
      expect(stats.numSubjects).toBe(9);
      expect(stats.numObjects).toBe(30);
      expect(stats.description).toBe("Test dataset of famous scientists");
    });
  });

  // -----------------------------------------------------------------------
  // describe_entity
  // -----------------------------------------------------------------------

  describe("describe_entity", () => {
    it("returns outgoing and incoming triples for an entity", async () => {
      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/Albert_Einstein" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("Entity: <http://example.org/Albert_Einstein>");
      expect(text).toContain("Outgoing properties (7 total)");
      expect(text).toContain("Incoming references (0 total)");
      expect(text).toContain("Albert Einstein");
      expect(text).toContain("birthYear");
      expect(text).toContain("Physics");
    });

    it("wraps bare IRIs in angle brackets", async () => {
      let receivedQueries: string[] = [];
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQueries.push(params.get("query") ?? "");
        return mockQueryResult({ selected: ["?predicate", "?object"], res: [] });
      });

      await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/test" },
      });

      // Both outgoing and incoming queries should use angle-bracketed IRI
      expect(receivedQueries[0]).toContain("<http://example.org/test>");
      expect(receivedQueries[1]).toContain("<http://example.org/test>");
    });

    it("preserves already-bracketed IRIs without double-wrapping", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?predicate", "?object"], res: [] });
      });

      await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "<http://example.org/test>" },
      });

      expect(receivedQuery).toContain("<http://example.org/test>");
      expect(receivedQuery).not.toContain("<<http://example.org/test>>");
    });

    it("respects custom limit in both outgoing and incoming queries", async () => {
      let receivedQueries: string[] = [];
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQueries.push(params.get("query") ?? "");
        return mockQueryResult({ selected: ["?predicate", "?object"], res: [] });
      });

      await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/test", limit: 25 },
      });

      expect(receivedQueries[0]).toContain("LIMIT 25");
      expect(receivedQueries[1]).toContain("LIMIT 25");
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Entity not found"));

      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/nonexistent" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Entity not found");
    });
  });

  // -----------------------------------------------------------------------
  // search_entities
  // -----------------------------------------------------------------------

  describe("search_entities", () => {
    it("searches for entities by label text", async () => {
      const result = await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "Einstein" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("Albert_Einstein");
      expect(text).toContain("Albert Einstein");
    });

    it("returns 'No results' for no matches", async () => {
      const result = await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "xyz_no_match" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("No results");
    });

    it("uses custom label predicate in generated query", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_entities",
        arguments: {
          search_term: "test",
          label_predicate: "schema:name",
        },
      });

      expect(receivedQuery).toContain("schema:name");
      // Should not contain the default rdfs:label as the predicate in the triple pattern
      expect(receivedQuery).toContain("?entity schema:name ?label");
    });

    it("escapes double quotes in search term", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: 'test "quoted" value' },
      });

      // Quotes should be escaped to prevent SPARQL injection
      expect(receivedQuery).toContain('\\"quoted\\"');
      expect(receivedQuery).not.toMatch(/LCASE\("test "quoted"/);
    });

    it("respects custom limit", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "test", limit: 5 },
      });

      expect(receivedQuery).toContain("LIMIT 5");
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Search failed"));

      const result = await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "test" },
      });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // get_predicates
  // -----------------------------------------------------------------------

  describe("get_predicates", () => {
    it("lists predicates ordered by frequency", async () => {
      const result = await mcpClient.callTool({
        name: "get_predicates",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("?predicate");
      expect(text).toContain("?count");
      // First predicate (highest frequency) should be rdf:type
      expect(text).toContain("rdf-syntax-ns#type");
      expect(text).toContain("Showing 7 of 7 results");
    });

    it("respects custom limit", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?predicate", "?count"], res: [] });
      });

      await mcpClient.callTool({
        name: "get_predicates",
        arguments: { limit: 10 },
      });

      expect(receivedQuery).toContain("LIMIT 10");
    });

    it("query uses GROUP BY and ORDER BY DESC", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?predicate", "?count"], res: [] });
      });

      await mcpClient.callTool({
        name: "get_predicates",
        arguments: {},
      });

      expect(receivedQuery).toContain("GROUP BY ?predicate");
      expect(receivedQuery).toContain("ORDER BY DESC(?count)");
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Predicate query failed"));

      const result = await mcpClient.callTool({
        name: "get_predicates",
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling across all tools
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("all tools return isError=true on network failure", async () => {
      // Point client at a port with nothing running
      const badClient = new QleverClient({
        endpoint: "http://127.0.0.1:19999",
        defaultTimeout: "1s",
      });

      const badServer = new McpServer({ name: "bad-test", version: "0.0.1" });
      registerTools(badServer, badClient);

      const badMcpClient = new Client({ name: "bad-client", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await badServer.connect(st);
      await badMcpClient.connect(ct);

      // Test all tools that take no required args or just a query
      const toolCases: Array<{ name: string; arguments: Record<string, unknown> }> = [
        { name: "sparql_query", arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }" } },
        { name: "sparql_query_json", arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }" } },
        { name: "get_index_stats", arguments: {} },
        { name: "describe_entity", arguments: { iri: "http://example.org/test" } },
        { name: "search_entities", arguments: { search_term: "test" } },
        { name: "get_predicates", arguments: {} },
      ];

      for (const { name, arguments: args } of toolCases) {
        const result = await badMcpClient.callTool({ name, arguments: args });
        expect(result.isError, `${name} should return isError=true on network failure`).toBe(true);
        const text = getText(result);
        expect(text.length, `${name} should have an error message`).toBeGreaterThan(0);
      }
    });
  });
});
