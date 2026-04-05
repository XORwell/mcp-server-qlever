/**
 * Security and input validation tests.
 *
 * Covers SPARQL injection prevention, HTTP error handling, timeout format
 * validation, numeric bound enforcement, null-safe error responses, and
 * QleverError property verification.
 *
 * All rejection tests go through the MCP tool interface via InMemoryTransport
 * to validate end-to-end behavior, not just zod-level validation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { QleverClient, QleverError } from "../../src/qlever-client.js";
import { registerTools } from "../../src/tools.js";
import { registerAdvancedTools } from "../../src/advanced-tools.js";
import {
  MockQleverServer,
  mockQueryResult,
  mockStatsResult,
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

    const qleverClient = new QleverClient({
      endpoint: mock.url,
      defaultTimeout: "10s",
      accessToken: "test-token",
    });
    const mcpServer = new McpServer({ name: "test-security", version: "0.0.1" });
    registerTools(mcpServer, qleverClient);
    registerAdvancedTools(mcpServer, qleverClient);

    mcpClient = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  });

  // -----------------------------------------------------------------------
  // 1. label_predicate injection prevention
  // -----------------------------------------------------------------------

  describe("label_predicate validation — rejects malicious patterns", () => {
    const maliciousPredicates: Array<[string, string]> = [
      // SPARQL injection with closing brace
      ['?p } . ?x <http://fake> ?y . SELECT * WHERE { ?x ?p', "closing brace injection"],
      // Semicolon injection
      ["DROP ALL;", "semicolon injection"],
      // Newline injection
      ["rdfs:label\n?x ?y ?z", "newline injection"],
      // Comment injection
      ["rdfs:label # this is a comment", "comment injection with #"],
      // Empty string
      ["", "empty string"],
      // UNION injection
      ["rdfs:label . ?x ?y ?z } UNION { SELECT *", "UNION injection"],
      // DELETE injection
      ['"; DELETE WHERE { ?s ?p ?o }', "DELETE injection"],
      // Spaces
      ["rdfs label", "space in predicate"],
      ["foo bar:baz", "space before colon"],
      // Malformed IRIs
      ["<unclosed", "unclosed angle bracket"],
      ["unclosed>", "missing opening angle bracket"],
      // Tab injection
      ["rdfs:label\t?x", "tab injection"],
    ];

    for (const [malicious, description] of maliciousPredicates) {
      it(`rejects ${description}: "${malicious.slice(0, 40).replace(/\n/g, "\\n")}"`, async () => {
        const result = await mcpClient.callTool({
          name: "search_entities",
          arguments: { search_term: "test", label_predicate: malicious },
        });

        expect(result.isError, `should reject: ${description}`).toBe(true);
      });
    }
  });

  describe("label_predicate validation — accepts valid predicates", () => {
    const validPredicates: Array<[string, string]> = [
      // Standard prefixed names
      ["rdfs:label", "rdfs:label"],
      ["schema:name", "schema:name"],
      ["skos:prefLabel", "skos:prefLabel"],
      ["foaf:name", "foaf:name"],
      ["wdt:P31", "Wikidata property"],
      // Full IRIs
      ["<http://www.w3.org/2000/01/rdf-schema#label>", "full IRI with fragment"],
      ["<http://schema.org/name>", "full IRI"],
      // Edge cases
      [":localName", "empty prefix (default namespace)"],
      ["a:b", "minimal prefixed name"],
      ["ns_:prop", "underscore in prefix"],
      ["my.ontology:some-prop", "dots and hyphens"],
    ];

    for (const [valid, description] of validPredicates) {
      it(`accepts ${description}: "${valid}"`, async () => {
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

        expect(result.isError, `should accept: ${description}`).toBeFalsy();
        expect(receivedQuery).toContain(`?entity ${valid} ?label`);
      });
    }
  });

  // -----------------------------------------------------------------------
  // 2. HTTP error handling
  // -----------------------------------------------------------------------

  describe("HTTP error handling", () => {
    const errorCodes: Array<[number, string]> = [
      [400, "Bad Request"],
      [401, "Unauthorized"],
      [403, "Forbidden"],
      [429, "Too Many Requests (rate limit)"],
      [500, "Internal Server Error"],
      [503, "Service Unavailable"],
    ];

    for (const [status, description] of errorCodes) {
      it(`throws QleverError for HTTP ${status} (${description})`, async () => {
        const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

        mock.setHandler(() => ({
          status,
          body: `Error ${status}`,
        }));

        await expect(
          client.query("SELECT ?x WHERE { ?x ?y ?z }"),
        ).rejects.toThrow(QleverError);
      });

      it(`includes status code ${status} in error message`, async () => {
        const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

        mock.setHandler(() => ({
          status,
          body: `Error ${status}`,
        }));

        await expect(
          client.query("SELECT ?x WHERE { ?x ?y ?z }"),
        ).rejects.toThrow(new RegExp(String(status)));
      });
    }

    it("surfaces HTTP errors through MCP tool interface", async () => {
      mock.setHandler(() => ({
        status: 500,
        body: "Internal Server Error",
      }));

      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("500");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Timeout format validation
  // -----------------------------------------------------------------------

  describe("timeout format validation", () => {
    const validTimeouts = ["30s", "5000ms", "2min", "1h", "100ns", "50us"];

    for (const timeout of validTimeouts) {
      it(`accepts valid timeout via MCP tool: "${timeout}"`, async () => {
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

    const invalidTimeouts: Array<[string, string]> = [
      ["30", "bare number, no unit"],
      ["abc", "non-numeric"],
      ["30seconds", "invalid unit 'seconds'"],
      ["5 s", "space between number and unit"],
      ["30S", "uppercase unit"],
      ["-5s", "negative number"],
      ["0", "zero without unit"],
      ["", "empty string"],
      ["30sec", "invalid unit 'sec'"],
    ];

    for (const [timeout, description] of invalidTimeouts) {
      it(`rejects invalid timeout via MCP tool: "${timeout}" (${description})`, async () => {
        const result = await mcpClient.callTool({
          name: "sparql_query",
          arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", timeout },
        });

        expect(result.isError, `should reject: ${description}`).toBe(true);
      });
    }

    it("also validates timeout in sparql_query_json via MCP tool", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", timeout: "bad" },
      });
      expect(result.isError).toBe(true);
    });

    it("validates timeout at client level (throws QleverError)", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });
      await expect(
        client.query("SELECT 1", { timeout: "invalid" }),
      ).rejects.toThrow(QleverError);
    });

    it("client-level timeout error message is descriptive", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });
      await expect(
        client.query("SELECT 1", { timeout: "foobar" }),
      ).rejects.toThrow(/Invalid timeout format.*foobar/);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Numeric bounds enforcement
  // -----------------------------------------------------------------------

  describe("numeric bounds enforcement", () => {
    // sparql_query max_rows
    it("rejects sparql_query max_rows > 10000 (one over)", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10001 },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts sparql_query max_rows = 10000 (boundary)", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10000 },
      });
      expect(result.isError).toBeFalsy();
    });

    // sparql_query_json max_rows
    it("rejects sparql_query_json max_rows > 10000 (one over)", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10001 },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts sparql_query_json max_rows = 10000 (boundary)", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query_json",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 10000 },
      });
      expect(result.isError).toBeFalsy();
    });

    // describe_entity limit
    it("rejects describe_entity limit > 10000 (one over)", async () => {
      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/test", limit: 10001 },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts describe_entity limit = 10000 (boundary)", async () => {
      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/test", limit: 10000 },
      });
      expect(result.isError).toBeFalsy();
    });

    // search_entities limit
    it("rejects search_entities limit > 1000 (one over)", async () => {
      const result = await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "test", limit: 1001 },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts search_entities limit = 1000 (boundary)", async () => {
      const result = await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "test", limit: 1000 },
      });
      expect(result.isError).toBeFalsy();
    });

    // get_predicates limit
    it("rejects get_predicates limit > 1000 (one over)", async () => {
      const result = await mcpClient.callTool({
        name: "get_predicates",
        arguments: { limit: 1001 },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts get_predicates limit = 1000 (boundary)", async () => {
      const result = await mcpClient.callTool({
        name: "get_predicates",
        arguments: { limit: 1000 },
      });
      expect(result.isError).toBeFalsy();
    });

    // Non-positive values
    it("rejects zero max_rows", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 0 },
      });
      expect(result.isError).toBe(true);
    });

    it("rejects negative max_rows", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: -1 },
      });
      expect(result.isError).toBe(true);
    });

    // Very large values
    it("rejects absurdly large max_rows", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT ?x WHERE { ?x ?y ?z }", max_rows: 999999999 },
      });
      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Null exception in error response
  // -----------------------------------------------------------------------

  describe("null exception field in error response", () => {
    it('returns "Unknown QLever error" when exception field is missing', async () => {
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

    it("surfaces missing-exception errors through MCP tool interface", async () => {
      mock.setHandler(() => ({
        body: { status: "ERROR" },
      }));

      const result = await mcpClient.callTool({
        name: "sparql_query",
        arguments: { query: "SELECT 1" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("Unknown QLever error");
    });
  });

  // -----------------------------------------------------------------------
  // 6. search_entities SPARQL string injection prevention
  // -----------------------------------------------------------------------

  describe("search_entities — SPARQL string injection prevention", () => {
    it("escapes backslash in search_term (prevents literal breakout)", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      // A trailing backslash would escape the closing quote without proper escaping
      await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "test\\" },
      });

      // The backslash must be doubled in the query
      expect(receivedQuery).toContain("test\\\\");
      // The query must still have a valid closing quote after the escaped content
      expect(receivedQuery).not.toMatch(/test\\"/);
    });

    it("escapes double-quote in search_term", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: 'say "hello"' },
      });

      expect(receivedQuery).toContain('say \\"hello\\"');
    });

    it("escapes newline in search_term (prevents multi-line literal)", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: "line1\nline2" },
      });

      // Newline must be escaped, not raw
      expect(receivedQuery).not.toContain("line1\nline2");
      expect(receivedQuery).toContain("line1\\nline2");
    });

    it("escapes backslash-quote combo (classic injection vector)", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?label"], res: [] });
      });

      // \" in input — without proper escaping, this closes the literal
      await mcpClient.callTool({
        name: "search_entities",
        arguments: { search_term: '\\" ) } DELETE WHERE { ?s ?p ?o' },
      });

      // The backslash must be escaped (\\) and the quote must be escaped (\")
      // so the entire payload stays inside the SPARQL string literal.
      // In the query: the \" becomes \\\\" (escaped backslash + escaped quote)
      expect(receivedQuery).toContain('\\\\\\"');
      // The FILTER must still be properly closed — the literal is not broken
      expect(receivedQuery).toMatch(/FILTER\(CONTAINS/);
      expect(receivedQuery).toMatch(/\)\)\s*\n\}/);
    });
  });

  // -----------------------------------------------------------------------
  // 7. describe_entity IRI injection prevention
  // -----------------------------------------------------------------------

  describe("describe_entity — IRI injection prevention", () => {
    const maliciousIris: Array<[string, string]> = [
      // Closing bracket injection
      ["http://example.org/test> } DELETE WHERE { ?s ?p ?o", "closing bracket injection"],
      // Space in IRI
      ["http://example.org/test foo", "space injection"],
      // Newline in IRI
      ["http://example.org/test\nDELETE", "newline injection"],
      // Backslash in IRI
      ["http://example.org/test\\", "backslash injection"],
      // Curly braces
      ["http://example.org/{inject}", "curly brace injection"],
      // Pipe
      ["http://example.org/test|inject", "pipe injection"],
    ];

    for (const [iri, description] of maliciousIris) {
      it(`rejects ${description}`, async () => {
        const result = await mcpClient.callTool({
          name: "describe_entity",
          arguments: { iri },
        });

        expect(result.isError, `should reject: ${description}`).toBe(true);
        const text = getText(result);
        expect(text).toContain("illegal characters");
      });
    }

    it("rejects unclosed angle bracket", async () => {
      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "<http://example.org/test" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("does not end with '>'");
    });

    it("rejects empty IRI", async () => {
      const result = await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "" },
      });

      expect(result.isError).toBe(true);
    });

    it("accepts valid full IRI and wraps it", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?predicate", "?object"], res: [] });
      });

      await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "http://example.org/valid" },
      });

      expect(receivedQuery).toContain("<http://example.org/valid>");
    });

    it("accepts valid bracketed IRI", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?predicate", "?object"], res: [] });
      });

      await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "<http://example.org/valid>" },
      });

      expect(receivedQuery).toContain("<http://example.org/valid>");
    });

    it("accepts valid prefixed name", async () => {
      const receivedQueries: string[] = [];
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQueries.push(params.get("query") ?? "");
        return mockQueryResult({ selected: ["?predicate", "?object"], res: [] });
      });

      await mcpClient.callTool({
        name: "describe_entity",
        arguments: { iri: "wdt:Q42" },
      });

      // First query: outgoing (entity is subject)
      expect(receivedQueries[0]).toContain("wdt:Q42 ?predicate");
      // Second query: incoming (entity is object)
      expect(receivedQueries[1]).toContain("?predicate wdt:Q42");
    });
  });

  // -----------------------------------------------------------------------
  // 8. sparql_update — broadened dangerous operation detection
  // -----------------------------------------------------------------------

  describe("sparql_update — dangerous operation detection", () => {
    const dangerousOps: Array<[string, string]> = [
      ["DROP ALL", "DROP ALL"],
      ["CLEAR ALL", "CLEAR ALL"],
      ["DROP SILENT ALL", "DROP SILENT ALL"],
      ["CLEAR SILENT ALL", "CLEAR SILENT ALL"],
      ["DROP DEFAULT", "DROP DEFAULT"],
      ["CLEAR DEFAULT", "CLEAR DEFAULT"],
      ["DROP NAMED", "DROP NAMED"],
      ["CLEAR NAMED", "CLEAR NAMED"],
      ["DROP SILENT DEFAULT", "DROP SILENT DEFAULT"],
      ["CLEAR SILENT NAMED", "CLEAR SILENT NAMED"],
      // Case insensitive
      ["drop all", "drop all (lowercase)"],
      ["Drop Named", "Drop Named (mixed case)"],
    ];

    for (const [update, description] of dangerousOps) {
      it(`blocks ${description} without confirm`, async () => {
        const result = await mcpClient.callTool({
          name: "sparql_update",
          arguments: { update },
        });

        expect(result.isError, `should block: ${description}`).toBe(true);
        const text = getText(result);
        expect(text).toContain("Destructive operation detected");
      });
    }

    const safeOps: Array<[string, string]> = [
      ["INSERT DATA { <a> <b> <c> }", "INSERT DATA"],
      ["DELETE WHERE { <a> <b> <c> }", "DELETE WHERE"],
      ["DROP GRAPH <http://example.org/g>", "DROP specific GRAPH"],
      ["CLEAR GRAPH <http://example.org/g>", "CLEAR specific GRAPH"],
    ];

    for (const [update, description] of safeOps) {
      it(`allows ${description} without confirm`, async () => {
        mock.setHandler(() => ({
          body: { message: "OK" },
        }));

        const result = await mcpClient.callTool({
          name: "sparql_update",
          arguments: { update },
        });

        expect(result.isError, `should allow: ${description}`).toBeFalsy();
      });
    }
  });

  // -----------------------------------------------------------------------
  // 9. sparql_update — graph_uri validation
  // -----------------------------------------------------------------------

  describe("sparql_update — graph_uri validation", () => {
    it("rejects malicious graph_uri with injection payload", async () => {
      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <a> <b> <c> }",
          graph_uri: "http://x> } DROP ALL; #",
        },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts valid graph_uri IRI", async () => {
      mock.setHandler(() => ({ body: { message: "OK" } }));
      const result = await mcpClient.callTool({
        name: "sparql_update",
        arguments: {
          update: "INSERT DATA { <a> <b> <c> }",
          graph_uri: "<http://example.org/graph1>",
        },
      });
      expect(result.isError).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // 10. search_fulltext — SPARQL injection via keywords
  // -----------------------------------------------------------------------

  describe("search_fulltext — keyword injection prevention", () => {
    it("escapes backslash in keywords", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?score", "?text"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_fulltext",
        arguments: { keywords: "test\\" },
      });

      expect(receivedQuery).toContain("test\\\\");
    });

    it("escapes quotes in keywords", async () => {
      let receivedQuery = "";
      mock.setHandler((_m, _u, body) => {
        const params = new URLSearchParams(body);
        receivedQuery = params.get("query") ?? "";
        return mockQueryResult({ selected: ["?entity", "?score", "?text"], res: [] });
      });

      await mcpClient.callTool({
        name: "search_fulltext",
        arguments: { keywords: 'say "hello"' },
      });

      expect(receivedQuery).toContain('say \\"hello\\"');
    });

    it("rejects malicious filter_type IRI", async () => {
      const result = await mcpClient.callTool({
        name: "search_fulltext",
        arguments: {
          keywords: "test",
          filter_type: "http://example.org/Q5> } DELETE WHERE { ?s ?p ?o",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("illegal characters");
    });

    it("accepts valid filter_type IRI", async () => {
      mock.setHandler((_m, _u, body) => {
        return mockQueryResult({ selected: ["?entity", "?score", "?text"], res: [] });
      });

      const result = await mcpClient.callTool({
        name: "search_fulltext",
        arguments: {
          keywords: "test",
          filter_type: "http://www.wikidata.org/entity/Q5",
        },
      });

      expect(result.isError).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // 10. QleverError properties
  // -----------------------------------------------------------------------

  describe("QleverError properties", () => {
    it('has name "QleverError"', async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

      mock.setHandler(() => ({
        body: { status: "ERROR", exception: "test error" },
      }));

      try {
        await client.query("SELECT 1");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).name).toBe("QleverError");
      }
    });

    it("preserves query in error for QLever-level errors", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });
      const testQuery = "SELECT ?x WHERE { ?x ?y ?z }";

      mock.setHandler(() => ({
        body: { status: "ERROR", exception: "Parse error" },
      }));

      try {
        await client.query(testQuery);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).query).toBe(testQuery);
      }
    });

    it("query is undefined for HTTP-level errors", async () => {
      const client = new QleverClient({ endpoint: mock.url, defaultTimeout: "10s" });

      mock.setHandler(() => ({
        status: 500,
        body: "Internal Server Error",
      }));

      try {
        await client.query("SELECT 1");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QleverError);
        expect((err as QleverError).query).toBeUndefined();
      }
    });

    it("is an instance of Error", () => {
      const err = new QleverError("test");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(QleverError);
    });
  });
});
