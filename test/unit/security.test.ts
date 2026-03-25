/**
 * Security and input validation tests.
 *
 * Covers SPARQL injection prevention, HTTP error handling, timeout format
 * validation, numeric bound enforcement, and null-safe error responses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { QleverClient, QleverError } from "../../src/qlever-client.js";
import { registerTools } from "../../src/tools.js";
import {
  MockQleverServer,
  mockQueryResult,
  type MockResponse,
} from "../mock-server.js";

/** Extract the text from a callTool result. */
function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe("Security & Input Validation", () => {
  let mock: MockQleverServer;
  let mcpClient: Client;

  const defaultHandler = (_method: string, _url: URL, _body: string): MockResponse => {
    return mockQueryResult({ selected: ["?x"], res: [] });
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

    const qleverClient = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });
    const mcpServer = new McpServer({ name: "test-security", version: "0.0.1" });
    registerTools(mcpServer, qleverClient);

    mcpClient = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  });

  // -----------------------------------------------------------------------
  // label_predicate injection prevention
  // -----------------------------------------------------------------------

  describe("label_predicate validation", () => {
    const maliciousPredicates = [
      '?p } . ?x <http://fake> ?y . SELECT * WHERE { ?x ?p',
      "rdfs:label . ?x ?y ?z } UNION { SELECT *",
      "DROP ALL;",
      '"; DELETE WHERE { ?s ?p ?o }',
      "rdfs label",
      "foo bar:baz",
      "<unclosed",
      "unclosed>",
      "",
    ];

    for (const malicious of maliciousPredicates) {
      it(`rejects injection attempt: "${malicious.slice(0, 40)}..."`, async () => {
        const result = await mcpClient.callTool({
          name: "search_entities",
          arguments: { search_term: "test", label_predicate: malicious },
        });

        // Zod validation should reject before query execution
        expect(result.isError).toBe(true);
      });
    }

    const validPredicates = [
      "rdfs:label",
      "schema:name",
      "skos:prefLabel",
      "foaf:name",
      "wdt:P31",
      "<http://www.w3.org/2000/01/rdf-schema#label>",
      "<http://schema.org/name>",
      "a:b",
      "_:x",
    ];

    for (const valid of validPredicates) {
      it(`accepts valid predicate: "${valid}"`, async () => {
        let receivedQuery = "";
        mock.setHandler((_m, _u, body) => {
          const params = new URLSearchParams(body);
          receivedQuery = params.get("query") ?? "";
          return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
        });

        const result = await mcpClient.callTool({
          name: "search_entities",
          arguments: { search_term: "test", label_predicate: valid },
        });

        expect(result.isError).toBeFalsy();
        expect(receivedQuery).toContain(`?entity ${valid} ?label`);
      });
    }
  });

  // -----------------------------------------------------------------------
  // HTTP error handling
  // -----------------------------------------------------------------------

  describe("HTTP error handling", () => {
    const errorCodes = [400, 401, 403, 429, 500, 503];

    for (const status of errorCodes) {
      it(`handles HTTP ${status} as an error`, async () => {
        const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

        mock.setHandler(() => ({
          status,
          body: `Error ${status}`,
        }));

        await expect(
          client.query("SELECT ?x WHERE { ?x ?y ?z }"),
        ).rejects.toThrow(QleverError);

        mock.setHandler(() => ({
          status,
          body: `Error ${status}`,
        }));

        await expect(
          client.query("SELECT ?x WHERE { ?x ?y ?z }"),
        ).rejects.toThrow(new RegExp(String(status)));
      });
    }
  });

  // -----------------------------------------------------------------------
  // Timeout format validation
  // -----------------------------------------------------------------------

  describe("timeout format validation", () => {
    const validTimeouts = ["30s", "5000ms", "2min", "1h", "100ns", "50us"];

    for (const timeout of validTimeouts) {
      it(`accepts valid timeout: "${timeout}"`, async () => {
        let receivedBody = "";
        mock.setHandler((_m, _u, body) => {
          receivedBody = body;
          return mockQueryResult({ selected: ["?x"], res: [] });
        });

        const result = await mcpClient.callTool({
          name: "sparql_query",
          arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", timeout },
        });

        expect(result.isError).toBeFalsy();
        const params = new URLSearchParams(receivedBody);
        expect(params.get("timeout")).toBe(timeout);
      });
    }

    const invalidTimeouts = ["30", "abc", "30seconds", "5 s", "30S", "-5s", ""];

    for (const timeout of invalidTimeouts) {
      it(`rejects invalid timeout: "${timeout}"`, async () => {
        const result = await mcpClient.callTool({
          name: "sparql_query",
          arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", timeout },
        });

        expect(result.isError).toBe(true);
      });
    }

    it("also validates timeout in sparql_query_json", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", timeout: "bad" },
      });
      expect(result.isError).toBe(true);
    });

    it("validates timeout at client level", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });
      await expect(
        client.query("SELECT 1", { timeout: "invalid" }),
      ).rejects.toThrow(QleverError);
    });
  });

  // -----------------------------------------------------------------------
  // Numeric bounds
  // -----------------------------------------------------------------------

  describe("numeric bounds enforcement", () => {
    it("rejects sparql_query max_rows > 10000", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10001 },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts sparql_query max_rows = 10000", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10000 },
      });
      expect(result.isError).toBeFalsy();
    });

    it("rejects sparql_query_json max_rows > 10000", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10001 },
      });
      expect(result.isError).toBe(true);
    });

    it("rejects describe_entity limit > 10000", async () => {
      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/test", limit: 10001 },
      });
      expect(result.isError).toBe(true);
    });

    it("rejects search_entities limit > 1000", async () => {
      const result = await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "test", limit: 1001 },
      });
      expect(result.isError).toBe(true);
    });

    it("rejects get_predicates limit > 1000", async () => {
      const result = await mcpClient.callTool({
        name: "get_predicates",
        arguments: { limit: 1001 },
      });
      expect(result.isError).toBe(true);
    });

    it("still rejects non-positive limits", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 0 },
      });
      expect(result.isError).toBe(true);

      const result2 = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: -1 },
      });
      expect(result2.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Null exception in error response
  // -----------------------------------------------------------------------

  describe("null exception field in error response", () => {
    it("handles error response with missing exception field", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

      mock.setHandler(() => ({
        body: { status: "ERROR" },
      }));

      try {
        await client.query("SELECT 1");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).message).toBe("Unknown QLever error");
      }
    });

    it("uses exception field when present", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

      mock.setHandler(() => ({
        body: { status: "ERROR", exception: "Specific error message" },
      }));

      await expect(
        client.query("SELECT 1"),
      ).rejects.toThrow("Specific error message");
    });
  });
});
