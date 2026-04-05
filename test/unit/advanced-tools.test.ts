/**
 * Unit tests for advanced MCP tools and prompts.
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
import { registerAdvancedTools } from "../../src/advanced-tools.js";
import { registerPrompts } from "../../src/prompts.js";
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

describe("Advanced MCP Tools", () => {
  let mock: MockQleverServer;
  let mcpClient: Client;
  let mcpServer: McpServer;

  const defaultHandler = (method: string, url: URL, body: string): MockResponse => {
    const cmd = url.searchParams.get("cmd");
    const pathname = url.pathname;

    // Autocompletion endpoint
    if (pathname.endsWith("/ac")) {
      const q = url.searchParams.get("q") ?? "";
      return {
        body: {
          query: q,
          completions: [
            { text: "<http://www.wikidata.org/entity/Q42>", score: 100 },
            { text: "<http://www.wikidata.org/entity/Q937>", score: 80 },
          ],
        },
      };
    }

    // Query plan analysis
    if (url.searchParams.get("action") === "plan") {
      return {
        body: {
          query: url.searchParams.get("query"),
          plan: {
            type: "SORT",
            estimatedSize: 1000,
            children: [
              {
                type: "JOIN",
                estimatedSize: 500,
              },
            ],
          },
        },
      };
    }

    if (cmd === "stats") {
      return mockStatsResult({
        name: "test-dataset",
        numTriples: 1000,
        numPredicates: 50,
      });
    }

    // SPARQL Update
    const contentType = method === "POST" && !body.includes("query=")
      ? "sparql-update"
      : "query";
    if (contentType === "sparql-update" && method === "POST") {
      return {
        body: {
          status: "OK",
          message: "Update executed successfully.",
        },
      };
    }

    // Parse query from URL-encoded body
    const params = new URLSearchParams(body);
    const query = params.get("query") ?? "";

    // Named graphs query
    if (query.includes("GRAPH ?g")) {
      return mockQueryResult({
        selected: ["?g", "?triples"],
        res: [
          ["<http://example.org/graph1>", "500"],
          ["<http://example.org/graph2>", "200"],
        ],
        totalResults: 2,
      });
    }

    // Fulltext search query
    if (query.includes("ql:contains-word")) {
      return mockQueryResult({
        selected: ["?entity", "?score", "?text"],
        res: [
          ["<http://example.org/Einstein>", "0.95", '"physics genius"'],
          ["<http://example.org/Curie>", "0.87", '"physics pioneer"'],
        ],
        totalResults: 2,
      });
    }

    // Spatial query (radius or bbox)
    if (query.includes("ql:spatialJoin") || query.includes("geof:latitude")) {
      return mockQueryResult({
        selected: ["?entity", "?label", "?coord"],
        res: [
          ["<http://example.org/Munich>", '"Munich"', '"POINT(11.5 48.1)"'],
        ],
        totalResults: 1,
      });
    }

    // Default
    return mockQueryResult({
      selected: ["?s", "?p", "?o"],
      res: [["<http://example.org/a>", "<http://example.org/b>", "<http://example.org/c>"]],
      totalResults: 1,
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

    const qleverClient = new QleverClient({
      endpoint: mock.url,
      accessToken: "test-token",
      defaultTimeout: "10s",
    });
    mcpServer = new McpServer({
      name: "test-qlever-advanced",
      version: "0.0.1",
    });
    registerTools(mcpServer, qleverClient);
    registerAdvancedTools(mcpServer, qleverClient);
    registerPrompts(mcpServer);

    mcpClient = new Client({ name: "test-client", version: "0.0.1" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  });

  // -----------------------------------------------------------------------
  // Tool listing
  // -----------------------------------------------------------------------

  describe("tool listing", () => {
    it("registers all 12 expected tools (6 base + 6 advanced)", async () => {
      const { tools } = await mcpClient.listTools();
      const names = tools.map((t) => t.name).sort();

      expect(names).toContain("sparql_autocomplete");
      expect(names).toContain("analyze_query");
      expect(names).toContain("list_named_graphs");
      expect(names).toContain("search_fulltext");
      expect(names).toContain("spatial_query");
      expect(names).toContain("sparql_update");
      expect(tools).toHaveLength(12);
    });
  });

  // -----------------------------------------------------------------------
  // sparql_autocomplete
  // -----------------------------------------------------------------------

  describe("sparql_autocomplete", () => {
    it("returns completions as a numbered list", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_autocomplete",
        arguments: { partial_query: "SELECT ?x WHERE { ?x " },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("1.");
      expect(text).toContain("Q42");
      expect(text).toContain("score: 100");
      expect(text).toContain("2.");
      expect(text).toContain("Q937");
    });

    it("returns 'No completions found' when empty", async () => {
      mock.setHandler((_m, url) => {
        if (url.pathname.endsWith("/ac")) {
          return { body: { completions: [] } };
        }
        return mockStatsResult();
      });

      const result = await mcpClient.callTool({
        name: "sparql_autocomplete",
        arguments: { partial_query: "xyz" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("No completions found");
    });

    it("passes limit parameter to the endpoint", async () => {
      let receivedLimit = "";
      mock.setHandler((_m, url) => {
        if (url.pathname.endsWith("/ac")) {
          receivedLimit = url.searchParams.get("limit") ?? "";
          return { body: { completions: [] } };
        }
        return mockStatsResult();
      });

      await mcpClient.callTool({
        name: "sparql_autocomplete",
        arguments: { partial_query: "test", limit: 5 },
      });

      expect(receivedLimit).toBe("5");
    });

    it("returns isError=true on failure", async () => {
      mock.setHandler((_m, url) => {
        if (url.pathname.endsWith("/ac")) {
          return { status: 500, body: "Internal Server Error" };
        }
        return mockStatsResult();
      });

      const result = await mcpClient.callTool({
        name: "sparql_autocomplete",
        arguments: { partial_query: "test" },
      });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // analyze_query
  // -----------------------------------------------------------------------

  describe("analyze_query", () => {
    it("returns query plan as JSON", async () => {
      const result = await mcpClient.callTool({
        name: "analyze_query",
        arguments: { query: "SELECT ?s WHERE { ?s ?p ?o }" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      const plan = JSON.parse(text);
      expect(plan.plan).toBeDefined();
      expect(plan.plan.type).toBe("SORT");
      expect(plan.plan.estimatedSize).toBe(1000);
    });

    it("returns isError=true on network failure", async () => {
      // Create a client pointing to a dead endpoint
      const badClient = new QleverClient({
        endpoint: "http://127.0.0.1:19999",
        defaultTimeout: "1s",
      });
      const badServer = new McpServer({ name: "bad-test", version: "0.0.1" });
      registerAdvancedTools(badServer, badClient);
      const badMcpClient = new Client({ name: "bad-client", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await badServer.connect(st);
      await badMcpClient.connect(ct);

      const result = await badMcpClient.callTool({
        name: "analyze_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }" },
      });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // list_named_graphs
  // -----------------------------------------------------------------------

  describe("list_named_graphs", () => {
    it("returns named graphs as a table", async () => {
      const result = await mcpClient.callTool({
        name: "list_named_graphs",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("?g");
      expect(text).toContain("?triples");
      expect(text).toContain("graph1");
      expect(text).toContain("500");
      expect(text).toContain("graph2");
    });

    it("respects custom limit", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?g", "?triples"], res: [] });
      });

      await mcpClient.callTool({
        name: "list_named_graphs",
        arguments: { limit: 10 },
      });

      expect(receivedQuery).toContain("LIMIT 10");
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Named graphs query failed"));

      const result = await mcpClient.callTool({
        name: "list_named_graphs",
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // search_fulltext
  // -----------------------------------------------------------------------

  describe("search_fulltext", () => {
    it("searches text index and returns results", async () => {
      const result = await mcpClient.callTool({
        name: "search_fulltext",
        arguments: { keywords: "physics" },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("Einstein");
      expect(text).toContain("Curie");
      expect(text).toContain("0.95");
    });

    it("includes type filter when provided", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?score", "?text"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_fulltext",
        arguments: {
          keywords: "physics",
          filter_type: "<http://www.wikidata.org/entity/Q5>",
        },
      });

      expect(receivedQuery).toContain("?entity a <http://www.wikidata.org/entity/Q5>");
    });

    it("escapes double quotes in keywords", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?score", "?text"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_fulltext",
        arguments: { keywords: 'test "quoted"' },
      });

      expect(receivedQuery).toContain('\\"quoted\\"');
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Text index not available"));

      const result = await mcpClient.callTool({
        name: "search_fulltext",
        arguments: { keywords: "test" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Text index not available");
    });
  });

  // -----------------------------------------------------------------------
  // spatial_query
  // -----------------------------------------------------------------------

  describe("spatial_query", () => {
    it("executes a radius spatial query", async () => {
      const result = await mcpClient.callTool({
        name: "spatial_query",
        arguments: {
          params: {
            mode: "radius",
            lat: 48.1,
            lon: 11.5,
            radius_km: 10,
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("Munich");
    });

    it("generates correct SPARQL for radius mode", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label", "?coord"], res: [] });
      });

      await mcpClient.callTool({
        name: "spatial_query",
        arguments: {
          params: {
            mode: "radius",
            lat: 48.1,
            lon: 11.5,
            radius_km: 10,
          },
        },
      });

      expect(receivedQuery).toContain("ql:spatialJoin");
      expect(receivedQuery).toContain("POINT(11.5 48.1)");
      expect(receivedQuery).toContain("10km");
    });

    it("executes a bounding box spatial query", async () => {
      const result = await mcpClient.callTool({
        name: "spatial_query",
        arguments: {
          params: {
            mode: "bbox",
            min_lat: 47.0,
            max_lat: 49.0,
            min_lon: 10.0,
            max_lon: 12.0,
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("Munich");
    });

    it("generates correct SPARQL for bbox mode", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label", "?coord"], res: [] });
      });

      await mcpClient.callTool({
        name: "spatial_query",
        arguments: {
          params: {
            mode: "bbox",
            min_lat: 47.0,
            max_lat: 49.0,
            min_lon: 10.0,
            max_lon: 12.0,
          },
        },
      });

      expect(receivedQuery).toContain("geof:latitude");
      expect(receivedQuery).toContain("geof:longitude");
      expect(receivedQuery).toContain(">= 47");
      expect(receivedQuery).toContain("<= 49");
    });

    it("includes type filter when provided", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label", "?coord"], res: [] });
      });

      await mcpClient.callTool({
        name: "spatial_query",
        arguments: {
          params: {
            mode: "radius",
            lat: 48.1,
            lon: 11.5,
            radius_km: 10,
            type_filter: "http://example.org/City",
          },
        },
      });

      expect(receivedQuery).toContain("?entity a <http://example.org/City>");
    });

    it("returns isError=true on query failure", async () => {
      mock.setHandler(() => mockErrorResult("Spatial join not supported"));

      const result = await mcpClient.callTool({
        name: "spatial_query",
        arguments: {
          params: {
            mode: "radius",
            lat: 48.1,
            lon: 11.5,
            radius_km: 10,
          },
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Spatial join not supported");
    });
  });

  // -----------------------------------------------------------------------
  // sparql_update
  // -----------------------------------------------------------------------

  describe("sparql_update", () => {
    it("executes an update and returns success", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("successful");
    });

    it("returns dry_run summary without executing", async () => {
      let requestReceived = false;
      mock.setHandler((_m, url, _body) => {
        if (url.searchParams.get("action") !== "plan" && !url.searchParams.get("cmd")) {
          requestReceived = true;
        }
        return { body: {} };
      });

      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
          dry_run: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("Dry run");
      expect(text).toContain("INSERT");
      expect(text).toContain("would NOT be executed");
    });

    it("detects dangerous DROP ALL and requires confirm", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "DROP ALL",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Destructive operation");
      expect(text).toContain("confirm: true");
    });

    it("detects dangerous CLEAR SILENT ALL and requires confirm", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "CLEAR SILENT ALL",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Destructive operation");
    });

    it("allows DROP ALL with confirm: true", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "DROP ALL",
          confirm: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("successful");
    });

    it("requires access token", async () => {
      // Create a client without access token
      const noTokenClient = new QleverClient({
        endpoint: mock.url,
        defaultTimeout: "10s",
      });
      const noTokenServer = new McpServer({ name: "no-token", version: "0.0.1" });
      registerAdvancedTools(noTokenServer, noTokenClient);
      const noTokenMcpClient = new Client({ name: "no-token-client", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await noTokenServer.connect(st);
      await noTokenMcpClient.connect(ct);

      const result = await noTokenMcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("access token");
      expect(text).toContain("QLEVER_ACCESS_TOKEN");
    });

    it("passes graph_uri to the client", async () => {
      let receivedUrl = "";
      mock.setHandler((_m, url, body) => {
        // Only capture sparql-update requests (not query= form-encoded)
        if (!body.includes("query=")) {
          receivedUrl = url.toString();
        }
        return { body: { status: "OK", message: "Done" } };
      });

      await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
          graph_uri: "<http://example.org/mygraph>",
        },
      });

      expect(receivedUrl).toContain("using-graph-uri=");
    });

    it("returns isError=true on update failure", async () => {
      mock.setHandler((_m, _u, body) => {
        if (!body.includes("query=")) {
          return {
            body: { status: "ERROR", exception: "Permission denied" },
          };
        }
        return mockQueryResult({ selected: ["?s"], res: [] });
      });

      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Permission denied");
    });
  });

  // -----------------------------------------------------------------------
  // Prompts
  // -----------------------------------------------------------------------

  describe("prompts", () => {
    it("registers explore_dataset prompt", async () => {
      const { prompts } = await mcpClient.listPrompts();
      const names = prompts.map((p) => p.name);
      expect(names).toContain("explore_dataset");
    });

    it("registers safe_update_workflow prompt", async () => {
      const { prompts } = await mcpClient.listPrompts();
      const names = prompts.map((p) => p.name);
      expect(names).toContain("safe_update_workflow");
    });

    it("explore_dataset returns step-by-step instructions", async () => {
      const result = await mcpClient.getPrompt({ name: "explore_dataset" });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain("get_index_stats");
      expect(content.text).toContain("get_predicates");
      expect(content.text).toContain("list_named_graphs");
      expect(content.text).toContain("sparql_autocomplete");
      expect(content.text).toContain("Start with step 1");
    });

    it("safe_update_workflow returns update workflow instructions", async () => {
      const result = await mcpClient.getPrompt({ name: "safe_update_workflow" });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain("dry_run");
      expect(content.text).toContain("sparql_update");
      expect(content.text).toContain("confirm: true");
    });
  });

  // -----------------------------------------------------------------------
  // Error handling across all advanced tools
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("all advanced tools return isError=true on network failure", async () => {
      const badClient = new QleverClient({
        endpoint: "http://127.0.0.1:19999",
        accessToken: "test-token",
        defaultTimeout: "1s",
      });

      const badServer = new McpServer({ name: "bad-test", version: "0.0.1" });
      registerAdvancedTools(badServer, badClient);

      const badMcpClient = new Client({ name: "bad-client", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await badServer.connect(st);
      await badMcpClient.connect(ct);

      const toolCases: Array<{ name: string; arguments: Record<string, unknown> }> = [
        { name: "sparql_autocomplete", arguments: { partial_query: "SELECT" } },
        { name: "analyze_query", arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }" } },
        { name: "list_named_graphs", arguments: {} },
        { name: "search_fulltext", arguments: { keywords: "test" } },
        {
          name: "spatial_query",
          arguments: { params: { mode: "radius", lat: 48.1, lon: 11.5, radius_km: 10 } },
        },
        {
          name: "sparql_update",
          arguments: { update: "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }" },
        },
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
