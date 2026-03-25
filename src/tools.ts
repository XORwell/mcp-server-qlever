/**
 * MCP tool definitions for the QLever SPARQL engine.
 *
 * Each tool is registered on the MCP server and delegates to a QleverClient
 * instance that is injected at startup.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  QleverClient,
  QleverError,
  type QleverQueryResult,
} from "./qlever-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a QLever query result as a human-readable text table. */
function formatResultAsText(result: QleverQueryResult): string {
  const { selected, res, resultSizeExported, resultSizeTotal, time } = result;

  if (res.length === 0) {
    return `No results. (${time.total})`;
  }

  const lines: string[] = [];

  // Header
  lines.push(selected.join("\t"));
  lines.push(selected.map((h) => "-".repeat(h.length)).join("\t"));

  // Rows
  for (const row of res) {
    lines.push(row.join("\t"));
  }

  // Footer
  lines.push("");
  lines.push(
    `Showing ${resultSizeExported} of ${resultSizeTotal} results (${time.total})`,
  );

  return lines.join("\n");
}

/** Wrap tool handler errors into user-friendly messages. */
function errorText(err: unknown): string {
  if (err instanceof QleverError) {
    return `QLever error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Unknown error: ${String(err)}`;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, client: QleverClient): void {
  // -----------------------------------------------------------------------
  // sparql_query — execute arbitrary SPARQL
  // -----------------------------------------------------------------------
  server.tool(
    "sparql_query",
    "Execute a SPARQL query against the configured QLever endpoint. " +
      "Supports SELECT, ASK, CONSTRUCT, and DESCRIBE query forms. " +
      "Returns results as a formatted table with timing information.",
    {
      query: z
        .string()
        .describe("The SPARQL query to execute"),
      timeout: z
        .string()
        .regex(
          /^\d+(ns|us|ms|s|min|h)$/,
          "Must be a QLever duration (e.g. '30s', '5000ms', '2min')",
        )
        .optional()
        .describe(
          "Query timeout in QLever duration format (e.g. '30s', '5000ms', '2min'). " +
            "Defaults to the server-configured timeout.",
        ),
      max_rows: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .describe(
          "Maximum number of result rows to return (max 10000). " +
            "The query still computes fully; this only limits serialization.",
        ),
    },
    async ({ query, timeout, max_rows }) => {
      try {
        const result = await client.query(query, {
          timeout,
          maxRows: max_rows,
        });
        return {
          content: [{ type: "text", text: formatResultAsText(result) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // sparql_query_json — execute SPARQL and return raw JSON
  // -----------------------------------------------------------------------
  server.tool(
    "sparql_query_json",
    "Execute a SPARQL query and return the raw QLever JSON response. " +
      "Useful when you need structured data for further processing " +
      "(result arrays, timing breakdown, total result count).",
    {
      query: z
        .string()
        .describe("The SPARQL query to execute"),
      timeout: z
        .string()
        .regex(
          /^\d+(ns|us|ms|s|min|h)$/,
          "Must be a QLever duration (e.g. '30s', '5000ms', '2min')",
        )
        .optional()
        .describe("Query timeout (e.g. '30s', '2min')"),
      max_rows: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .describe("Maximum number of result rows to serialize (max 10000)"),
    },
    async ({ query, timeout, max_rows }) => {
      try {
        const result = await client.query(query, {
          timeout,
          maxRows: max_rows,
        });
        return {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_index_stats — dataset metadata
  // -----------------------------------------------------------------------
  server.tool(
    "get_index_stats",
    "Retrieve metadata about the QLever index: dataset name, number of " +
      "triples, predicates, subjects, and objects. Useful for understanding " +
      "the scope of the knowledge graph before querying.",
    {},
    async () => {
      try {
        const stats = await client.getIndexStats();
        return {
          content: [
            { type: "text", text: JSON.stringify(stats, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // describe_entity — look up an entity by IRI
  // -----------------------------------------------------------------------
  server.tool(
    "describe_entity",
    "Look up all triples where a given IRI appears as subject or object. " +
      "Returns both outgoing properties (where the entity is the subject) " +
      "and incoming references (where it is the object). " +
      "Accepts full IRIs (e.g. <http://www.wikidata.org/entity/Q42>) " +
      "or prefixed names if the dataset supports them.",
    {
      iri: z
        .string()
        .describe(
          "The IRI of the entity to describe, e.g. '<http://www.wikidata.org/entity/Q42>'",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .default(100)
        .describe("Maximum number of triples to return (default: 100, max 10000)"),
    },
    async ({ iri, limit }) => {
      // Ensure the IRI is wrapped in angle brackets if not already
      const wrappedIri = iri.startsWith("<") ? iri : `<${iri}>`;

      const query = `
SELECT ?predicate ?object WHERE {
  ${wrappedIri} ?predicate ?object .
} LIMIT ${limit}`;

      try {
        const outgoing = await client.query(query, { maxRows: limit });

        const reverseQuery = `
SELECT ?subject ?predicate WHERE {
  ?subject ?predicate ${wrappedIri} .
} LIMIT ${limit}`;

        const incoming = await client.query(reverseQuery, { maxRows: limit });

        const lines: string[] = [];
        lines.push(`Entity: ${wrappedIri}`);
        lines.push("");
        lines.push(`--- Outgoing properties (${outgoing.resultSizeTotal} total) ---`);
        lines.push(formatResultAsText(outgoing));
        lines.push("");
        lines.push(`--- Incoming references (${incoming.resultSizeTotal} total) ---`);
        lines.push(formatResultAsText(incoming));

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // search_entities — full-text search for entities
  // -----------------------------------------------------------------------
  server.tool(
    "search_entities",
    "Search for entities by name or label using SPARQL text matching. " +
      "Works with datasets that have rdfs:label or schema:name predicates. " +
      "Returns matching entities with their labels.",
    {
      search_term: z
        .string()
        .describe("The text to search for in entity labels"),
      label_predicate: z
        .string()
        .regex(
          /^([a-zA-Z_][a-zA-Z0-9_.\-]*:[a-zA-Z0-9_.\-]*|:[a-zA-Z0-9_.\-]+|<[^>]+>)$/,
          "Must be a prefixed name (e.g. 'rdfs:label') or a full IRI (e.g. '<http://...>')",
        )
        .optional()
        .default("rdfs:label")
        .describe(
          "The predicate used for labels (default: rdfs:label). " +
            "Use 'schema:name' for schema.org-based datasets, " +
            "or a full IRI like '<http://www.w3.org/2000/01/rdf-schema#label>'.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(1000)
        .optional()
        .default(20)
        .describe("Maximum number of results (default: 20, max 1000)"),
    },
    async ({ search_term, label_predicate, limit }) => {
      const query = `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
SELECT ?entity ?label WHERE {
  ?entity ${label_predicate} ?label .
  FILTER(CONTAINS(LCASE(STR(?label)), LCASE("${search_term.replace(/"/g, '\\"')}")))
} LIMIT ${limit}`;

      try {
        const result = await client.query(query, { maxRows: limit });
        return {
          content: [{ type: "text", text: formatResultAsText(result) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_predicates — list available predicates in the dataset
  // -----------------------------------------------------------------------
  server.tool(
    "get_predicates",
    "List the predicates (properties) available in the dataset, ordered by " +
      "frequency. Useful for exploring an unfamiliar knowledge graph and " +
      "understanding its schema before writing queries.",
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(1000)
        .optional()
        .default(50)
        .describe("Maximum number of predicates to return (default: 50, max 1000)"),
    },
    async ({ limit }) => {
      const query = `
SELECT ?predicate (COUNT(?predicate) AS ?count) WHERE {
  ?s ?predicate ?o .
} GROUP BY ?predicate ORDER BY DESC(?count) LIMIT ${limit}`;

      try {
        const result = await client.query(query);
        return {
          content: [{ type: "text", text: formatResultAsText(result) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );
}
