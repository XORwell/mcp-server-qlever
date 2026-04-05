/**
 * Unit tests for QleverClient.
 *
 * Uses a mock HTTP server to test the client in isolation — no Docker needed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QleverClient, QleverError } from "../../src/qlever-client.js";
import {
  MockQleverServer,
  mockQueryResult,
  mockErrorResult,
  mockStatsResult,
  type MockResponse,
} from "../mock-server.js";

describe("QleverClient", () => {
  let mock: MockQleverServer;
  let client: QleverClient;

  // Track last request details for assertions
  let lastMethod: string;
  let lastUrl: URL;
  let lastBody: string;
  let lastHeaders: Record<string, string>;

  // Default handler: echo back query parameters as a mock result
  const defaultHandler = (method: string, url: URL, body: string): MockResponse => {
    lastMethod = method;
    lastUrl = url;
    lastBody = body;

    const cmd = url.searchParams.get("cmd");
    if (cmd === "stats") {
      return mockStatsResult();
    }
    if (cmd === "cache-stats") {
      return { body: { pinnedSize: "0 B", nonPinnedSize: "1 MB" } };
    }
    // Query requests
    return mockQueryResult({
      selected: ["?s", "?p", "?o"],
      res: [
        ["<http://example.org/s1>", "<http://example.org/p1>", '"value1"'],
        ["<http://example.org/s2>", "<http://example.org/p2>", '"value2"'],
      ],
    });
  };

  beforeAll(async () => {
    mock = new MockQleverServer(defaultHandler);
    await mock.start();
  });

  afterAll(async () => {
    await mock.stop();
  });

  beforeEach(() => {
    mock.setHandler(defaultHandler);
    client = new QleverClient({ endpoint: mock.url });
    lastMethod = "";
    lastUrl = new URL("http://localhost");
    lastBody = "";
    lastHeaders = {};
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("strips trailing slashes from endpoint", async () => {
      const c = new QleverClient({ endpoint: `${mock.url}///` });
      // Verify by making a request — the URL should not have double slashes
      const stats = await c.getIndexStats();
      expect(stats.name).toBe("test-index");
      // The request URL should not have trailing slashes before query params
      expect(lastUrl.pathname).toBe("/");
    });

    it("accepts optional access token and timeout", () => {
      const c = new QleverClient({
        endpoint: "http://localhost:7019",
        accessToken: "secret",
        defaultTimeout: "5s",
      });
      expect(c).toBeDefined();
    });

    it("defaults timeout to 30s when not specified", async () => {
      const c = new QleverClient({ endpoint: mock.url });

      mock.setHandler((_m, _u, body) => {
        lastBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await c.query("SELECT ?x WHERE { ?x ?y ?z }");
      const params = new URLSearchParams(lastBody);
      expect(params.get("timeout")).toBe("30s");
    });
  });

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  describe("query()", () => {
    it("returns parsed result for a successful SELECT query", async () => {
      const result = await client.query("SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 2");

      expect(result.status).toBe("OK");
      expect(result.selected).toEqual(["?s", "?p", "?o"]);
      expect(result.res).toHaveLength(2);
      expect(result.resultSizeExported).toBe(2);
      expect(result.warnings).toEqual([]);
      expect(result.time).toBeDefined();
      expect(result.time.total).toBe("1ms");
    });

    it("sends query via POST with correct Content-Type", async () => {
      let receivedMethod = "";
      let receivedBody = "";

      mock.setHandler((method, _url, body) => {
        receivedMethod = method;
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [["1"]] });
      });

      await client.query("SELECT ?x WHERE { ?x ?y ?z }");

      expect(receivedMethod).toBe("POST");
      // Body is URL-encoded form data
      expect(receivedBody).toContain("query=");
      expect(receivedBody).toContain("timeout=");
      // Verify it can be parsed as URLSearchParams
      const params = new URLSearchParams(receivedBody);
      expect(params.get("query")).toBe("SELECT ?x WHERE { ?x ?y ?z }");
    });

    it("passes timeout parameter", async () => {
      let receivedBody = "";

      mock.setHandler((_method, _url, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await client.query("SELECT ?x WHERE { ?x ?y ?z }", { timeout: "5s" });

      const params = new URLSearchParams(receivedBody);
      expect(params.get("timeout")).toBe("5s");
    });

    it("passes maxRows as send parameter", async () => {
      let receivedBody = "";

      mock.setHandler((_method, _url, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await client.query("SELECT ?x WHERE { ?x ?y ?z }", { maxRows: 100 });

      const params = new URLSearchParams(receivedBody);
      expect(params.get("send")).toBe("100");
    });

    it("does not include send param when maxRows is not specified", async () => {
      let receivedBody = "";

      mock.setHandler((_method, _url, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await client.query("SELECT ?x WHERE { ?x ?y ?z }");

      const params = new URLSearchParams(receivedBody);
      expect(params.has("send")).toBe(false);
    });

    it("uses default timeout when none specified", async () => {
      const customClient = new QleverClient({
        endpoint: mock.url,
        defaultTimeout: "42s",
      });

      let receivedBody = "";
      mock.setHandler((_method, _url, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await customClient.query("SELECT ?x WHERE { ?x ?y ?z }");

      const params = new URLSearchParams(receivedBody);
      expect(params.get("timeout")).toBe("42s");
    });

    it("overrides default timeout with explicit timeout", async () => {
      const customClient = new QleverClient({
        endpoint: mock.url,
        defaultTimeout: "42s",
      });

      let receivedBody = "";
      mock.setHandler((_method, _url, body) => {
        receivedBody = body;
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      await customClient.query("SELECT ?x WHERE { ?x ?y ?z }", { timeout: "2s" });

      const params = new URLSearchParams(receivedBody);
      expect(params.get("timeout")).toBe("2s");
    });

    it("throws QleverError on QLever error response", async () => {
      mock.setHandler(() => mockErrorResult("Parse error: unexpected token"));

      await expect(
        client.query("INVALID QUERY"),
      ).rejects.toThrow(QleverError);

      mock.setHandler(() => mockErrorResult("Parse error: unexpected token"));

      await expect(
        client.query("INVALID QUERY"),
      ).rejects.toThrow("Parse error: unexpected token");
    });

    it("throws QleverError on HTTP error", async () => {
      mock.setHandler(() => ({
        status: 500,
        body: "Internal Server Error",
      }));

      await expect(
        client.query("SELECT ?x WHERE { ?x ?y ?z }"),
      ).rejects.toThrow(QleverError);
    });

    it("includes HTTP status in error message for HTTP errors", async () => {
      mock.setHandler(() => ({
        status: 503,
        body: "Service Unavailable",
      }));

      await expect(
        client.query("SELECT ?x WHERE { ?x ?y ?z }"),
      ).rejects.toThrow(/503/);
    });

    it("throws QleverError on invalid JSON response", async () => {
      // When mock body is a string, it's sent raw (not JSON.stringified)
      mock.setHandler(() => ({
        body: "{{broken json",
        headers: { "Content-Type": "text/plain" },
      }));

      await expect(
        client.query("SELECT ?x WHERE { ?x ?y ?z }"),
      ).rejects.toThrow(QleverError);

      mock.setHandler(() => ({
        body: "{{broken json",
        headers: { "Content-Type": "text/plain" },
      }));

      await expect(
        client.query("SELECT ?x WHERE { ?x ?y ?z }"),
      ).rejects.toThrow(/Invalid JSON/);
    });

    it("includes query string in error when QLever returns error status", async () => {
      mock.setHandler(() => mockErrorResult("Timeout"));

      try {
        await client.query("SELECT ?x WHERE { ?x ?y ?z }");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).query).toBe("SELECT ?x WHERE { ?x ?y ?z }");
      }
    });

    it("error has name QleverError", async () => {
      mock.setHandler(() => mockErrorResult("Test error"));

      try {
        await client.query("SELECT 1");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).name).toBe("QleverError");
      }
    });

    it("handles empty result set", async () => {
      mock.setHandler(() =>
        mockQueryResult({ selected: ["?x"], res: [], totalResults: 0 }),
      );

      const result = await client.query("SELECT ?x WHERE { ?x ?y ?z }");
      expect(result.res).toEqual([]);
      expect(result.resultSizeTotal).toBe(0);
      expect(result.resultSizeExported).toBe(0);
      expect(result.status).toBe("OK");
    });
  });

  // -------------------------------------------------------------------------
  // getIndexStats()
  // -------------------------------------------------------------------------

  describe("getIndexStats()", () => {
    it("returns index statistics", async () => {
      const stats = await client.getIndexStats();

      expect(stats.name).toBe("test-index");
      expect(stats.numTriples).toBe(42);
      expect(stats.numPredicates).toBe(7);
      expect(stats.numSubjects).toBe(14);
      expect(stats.numObjects).toBe(30);
    });

    it("sends cmd=stats via GET", async () => {
      let receivedMethod = "";
      let receivedCmd = "";

      mock.setHandler((method, url) => {
        receivedMethod = method;
        receivedCmd = url.searchParams.get("cmd") ?? "";
        return mockStatsResult();
      });

      await client.getIndexStats();

      expect(receivedMethod).toBe("GET");
      expect(receivedCmd).toBe("stats");
    });

    it("throws QleverError on invalid JSON stats response", async () => {
      mock.setHandler(() => ({
        body: "not-json",
      }));

      await expect(client.getIndexStats()).rejects.toThrow(QleverError);
    });
  });

  // -------------------------------------------------------------------------
  // getCacheStats()
  // -------------------------------------------------------------------------

  describe("getCacheStats()", () => {
    it("returns cache statistics", async () => {
      const stats = await client.getCacheStats();

      expect(stats).toHaveProperty("pinnedSize");
      expect(stats).toHaveProperty("nonPinnedSize");
      expect(stats.pinnedSize).toBe("0 B");
      expect(stats.nonPinnedSize).toBe("1 MB");
    });

    it("sends cmd=cache-stats via GET", async () => {
      let receivedMethod = "";
      let receivedCmd = "";

      mock.setHandler((method, url) => {
        receivedMethod = method;
        receivedCmd = url.searchParams.get("cmd") ?? "";
        return { body: { pinnedSize: "0 B" } };
      });

      await client.getCacheStats();

      expect(receivedMethod).toBe("GET");
      expect(receivedCmd).toBe("cache-stats");
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("sends Authorization header when access token is configured", async () => {
      // Create a mock that captures request headers via a custom handler
      let receivedAuthHeader: string | undefined;

      // We need to intercept at the HTTP level. The mock server's handler
      // doesn't receive headers, but we can use a separate approach:
      // create a mock that checks via a custom server.
      const headerMock = new MockQleverServer((_method, _url, _body) => {
        return mockStatsResult();
      });

      // Override the internal server to capture headers
      const origServer = (headerMock as unknown as { server: import("node:http").Server }).server;
      origServer.removeAllListeners("request");
      origServer.on("request", (req, res) => {
        receivedAuthHeader = req.headers["authorization"];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ "name-index": "test", "num-triples-normal": 1, "num-predicates-normal": 1, "num-subjects-normal": 1, "num-objects-normal": 1 }));
      });

      await headerMock.start();
      try {
        const authedClient = new QleverClient({
          endpoint: headerMock.url,
          accessToken: "my-token",
        });

        await authedClient.getIndexStats();
        expect(receivedAuthHeader).toBe("Bearer my-token");
      } finally {
        await headerMock.stop();
      }
    });

    it("does not send Authorization header when no token is configured", async () => {
      let receivedAuthHeader: string | undefined = "SENTINEL";

      const headerMock = new MockQleverServer((_method, _url, _body) => {
        return mockStatsResult();
      });

      const origServer = (headerMock as unknown as { server: import("node:http").Server }).server;
      origServer.removeAllListeners("request");
      origServer.on("request", (req, res) => {
        receivedAuthHeader = req.headers["authorization"];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ "name-index": "test", "num-triples-normal": 1, "num-predicates-normal": 1, "num-subjects-normal": 1, "num-objects-normal": 1 }));
      });

      await headerMock.start();
      try {
        const noAuthClient = new QleverClient({
          endpoint: headerMock.url,
        });

        await noAuthClient.getIndexStats();
        expect(receivedAuthHeader).toBeUndefined();
      } finally {
        await headerMock.stop();
      }
    });

    it("sends Authorization header on analyzeQuery requests", async () => {
      let receivedAuthHeader: string | undefined;

      const headerMock = new MockQleverServer((_method, _url, _body) => {
        return { body: { plan: "test" } };
      });

      const origServer = (headerMock as unknown as { server: import("node:http").Server }).server;
      origServer.removeAllListeners("request");
      origServer.on("request", (req, res) => {
        receivedAuthHeader = req.headers["authorization"];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ plan: "test" }));
      });

      await headerMock.start();
      try {
        const authedClient = new QleverClient({
          endpoint: headerMock.url,
          accessToken: "analyze-token",
        });

        await authedClient.analyzeQuery("SELECT ?x WHERE { ?x ?y ?z }");
        expect(receivedAuthHeader).toBe("Bearer analyze-token");
      } finally {
        await headerMock.stop();
      }
    });

    it("sends Authorization header on POST query requests", async () => {
      let receivedAuthHeader: string | undefined;

      const headerMock = new MockQleverServer((_method, _url, _body) => {
        return mockQueryResult({ selected: ["?x"], res: [] });
      });

      const origServer = (headerMock as unknown as { server: import("node:http").Server }).server;
      origServer.removeAllListeners("request");
      origServer.on("request", (req, res) => {
        receivedAuthHeader = req.headers["authorization"];
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            query: "(mock)", status: "OK", warnings: [],
            selected: ["?x"], res: [], resultSizeExported: 0,
            resultSizeTotal: 0, time: { total: "1ms", computeResult: "0ms" },
          }));
        });
      });

      await headerMock.start();
      try {
        const authedClient = new QleverClient({
          endpoint: headerMock.url,
          accessToken: "query-token",
        });

        await authedClient.query("SELECT ?x WHERE { ?x ?y ?z }");
        expect(receivedAuthHeader).toBe("Bearer query-token");
      } finally {
        await headerMock.stop();
      }
    });
  });

  // -------------------------------------------------------------------------
  // endpoint getter
  // -------------------------------------------------------------------------

  describe("endpoint getter", () => {
    it("returns the configured endpoint", () => {
      expect(client.endpoint).toBe(mock.url);
    });

    it("returns endpoint with trailing slash stripped", () => {
      const c = new QleverClient({ endpoint: "http://example.org/api/" });
      expect(c.endpoint).toBe("http://example.org/api");
    });
  });

  // -------------------------------------------------------------------------
  // analyzeQuery()
  // -------------------------------------------------------------------------

  describe("analyzeQuery()", () => {
    it("sends query with action=plan via GET", async () => {
      let receivedQuery = "";
      let receivedAction = "";
      let receivedMethod = "";

      mock.setHandler((method, url) => {
        receivedMethod = method;
        receivedQuery = url.searchParams.get("query") ?? "";
        receivedAction = url.searchParams.get("action") ?? "";
        return { body: { plan: "mock-plan" } };
      });

      await client.analyzeQuery("SELECT ?x WHERE { ?x ?y ?z }");

      expect(receivedMethod).toBe("GET");
      expect(receivedQuery).toBe("SELECT ?x WHERE { ?x ?y ?z }");
      expect(receivedAction).toBe("plan");
    });

    it("returns parsed JSON when response is valid JSON", async () => {
      mock.setHandler(() => ({ body: { plan: "test-plan", cost: 42 } }));

      const result = await client.analyzeQuery("SELECT 1");
      expect(result).toEqual({ plan: "test-plan", cost: 42 });
    });

    it("returns raw text when response is not JSON", async () => {
      mock.setHandler(() => ({ body: "plain text plan output" }));

      const result = await client.analyzeQuery("SELECT 1");
      expect(result).toBe("plain text plan output");
    });

    it("throws QleverError on HTTP error", async () => {
      mock.setHandler(() => ({ status: 500, body: "Server Error" }));

      await expect(client.analyzeQuery("SELECT 1")).rejects.toThrow(QleverError);
    });
  });

  // -------------------------------------------------------------------------
  // update() error handling
  // -------------------------------------------------------------------------

  describe("update() error handling", () => {
    it('returns "Unknown QLever error" when exception field is missing', async () => {
      const authedClient = new QleverClient({
        endpoint: mock.url,
        accessToken: "token",
      });

      mock.setHandler(() => ({
        body: { status: "ERROR" },
      }));

      await expect(authedClient.update("INSERT DATA { <a> <b> <c> }")).rejects.toThrow(
        "Unknown QLever error",
      );
    });

    it("uses exception field when present in update error", async () => {
      const authedClient = new QleverClient({
        endpoint: mock.url,
        accessToken: "token",
      });

      mock.setHandler(() => ({
        body: { status: "ERROR", exception: "Parse error in update" },
      }));

      await expect(authedClient.update("BAD UPDATE")).rejects.toThrow(
        "Parse error in update",
      );
    });

    it("preserves update string in QleverError.query", async () => {
      const authedClient = new QleverClient({
        endpoint: mock.url,
        accessToken: "token",
      });

      mock.setHandler(() => ({
        body: { status: "ERROR", exception: "fail" },
      }));

      try {
        await authedClient.update("DELETE WHERE { ?s ?p ?o }");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).query).toBe("DELETE WHERE { ?s ?p ?o }");
      }
    });

    it("treats non-JSON 200 response as success", async () => {
      const authedClient = new QleverClient({
        endpoint: mock.url,
        accessToken: "token",
      });

      mock.setHandler(() => ({
        body: "Update successful",
      }));

      const result = await authedClient.update("INSERT DATA { <a> <b> <c> }");
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // autocomplete() URL construction
  // -------------------------------------------------------------------------

  describe("autocomplete()", () => {
    it("appends /ac to the endpoint path", async () => {
      let receivedPath = "";

      mock.setHandler((_method, url) => {
        receivedPath = url.pathname;
        return { body: { completions: [] } };
      });

      await client.autocomplete("SELECT ?x WHERE { ?x ");
      expect(receivedPath).toBe("/ac");
    });

    it("appends /ac without double slash for path-based endpoints", async () => {
      let receivedPath = "";

      const pathMock = new MockQleverServer((_method, url) => {
        receivedPath = url.pathname;
        return { body: { completions: [] } };
      });

      await pathMock.start();
      try {
        const pathClient = new QleverClient({
          endpoint: pathMock.url + "/api/wikidata",
        });
        await pathClient.autocomplete("SELECT ");
        expect(receivedPath).toBe("/api/wikidata/ac");
        expect(receivedPath).not.toContain("//");
      } finally {
        await pathMock.stop();
      }
    });

    it("passes query parameter as q", async () => {
      let receivedQ = "";

      mock.setHandler((_method, url) => {
        receivedQ = url.searchParams.get("q") ?? "";
        return { body: { completions: [] } };
      });

      await client.autocomplete("SELECT ?x WHERE { ?x ");
      expect(receivedQ).toBe("SELECT ?x WHERE { ?x ");
    });
  });

  // -------------------------------------------------------------------------
  // getIndexStats() normalization
  // -------------------------------------------------------------------------

  describe("getIndexStats() normalization", () => {
    it("preserves original kebab-case keys alongside camelCase", async () => {
      const stats = await client.getIndexStats();
      // camelCase normalized values
      expect(stats.numTriples).toBe(42);
      // original keys via index signature
      expect(stats["num-triples-normal"]).toBe(42);
      expect(stats["name-index"]).toBe("test-index");
    });

    it("coerces string values to numbers", async () => {
      mock.setHandler((_method, url) => {
        if (url.searchParams.get("cmd") === "stats") {
          return {
            body: {
              "name-index": "coerce-test",
              "num-triples-normal": "12345",
              "num-predicates-normal": "99",
              "num-subjects-normal": "500",
              "num-objects-normal": "300",
            },
          };
        }
        return mockStatsResult();
      });

      const stats = await client.getIndexStats();
      expect(stats.numTriples).toBe(12345);
      expect(typeof stats.numTriples).toBe("number");
    });

    it("defaults to 0 when stats fields are missing", async () => {
      mock.setHandler((_method, url) => {
        if (url.searchParams.get("cmd") === "stats") {
          return { body: {} };
        }
        return mockStatsResult();
      });

      const stats = await client.getIndexStats();
      expect(stats.numTriples).toBe(0);
      expect(stats.numPredicates).toBe(0);
      expect(stats.name).toBe("");
    });
  });
});
