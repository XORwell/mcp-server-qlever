/**
 * Advanced MCP tool definitions for QLever-specific features.
 *
 * Provides autocompletion, query analysis, named graphs, full-text search,
 * spatial queries, and SPARQL Update support.
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

/** Label predicate regex — matches prefixed names or full IRIs. */
const labelPredicateRegex =
  /^([a-zA-Z_][a-zA-Z0-9_.\-]*:[a-zA-Z0-9_.\-]*|<[^>]+>)$/;

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAdvancedTools(
  server: McpServer,
  client: QleverClient,
): void {
  // -----------------------------------------------------------------------
  // sparql_autocomplete — QLever context-sensitive autocompletion
  // -----------------------------------------------------------------------
  server.tool(
    "sparql_autocomplete",
    "Use this BEFORE sparql_query when unsure which predicates or entities exist. " +
      "Uses QLever's context-sensitive autocompletion, not generic SPARQL.",
    {
      partial_query: z
        .string()
        .describe("The partial SPARQL query to autocomplete"),
      context: z
        .string()
        .optional()
        .describe("Additional context for autocompletion"),
      entity_name: z
        .string()
        .optional()
        .describe("Entity name hint for autocompletion"),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of completions to return (default: 20, max: 100)"),
    },
    async ({ partial_query, context, entity_name, limit }) => {
      try {
        const result = await client.autocomplete(partial_query, {
          context,
          entityName: entity_name,
          limit,
        });

        if (!result.completions || result.completions.length === 0) {
          return { content: [{ type: "text", text: "No completions found." }] };
        }

        const lines: string[] = [];
        result.completions.forEach((c, i) => {
          const score = c.score !== undefined ? ` (score: ${c.score})` : "";
          lines.push(`${i + 1}. ${c.text}${score}`);
        });

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
  // analyze_query — query plan without execution
  // -----------------------------------------------------------------------
  server.tool(
    "analyze_query",
    "Analyze a SPARQL query plan WITHOUT executing it. " +
      "Shows estimated result sizes and costly operations.",
    {
      query: z
        .string()
        .describe("The SPARQL query to analyze"),
    },
    async ({ query }) => {
      try {
        const url = new URL(client["endpoint"]);
        url.searchParams.set("query", query);
        url.searchParams.set("action", "plan");

        const res = await globalThis.fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(client.hasAccessToken
              ? { Authorization: `Bearer ${client["accessToken"]}` }
              : {}),
          },
        });

        const text = await res.text();
        try {
          const plan = JSON.parse(text);
          return {
            content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          };
        } catch {
          return {
            content: [{ type: "text", text: text }],
          };
        }
      } catch (err) {
        return {
          content: [{ type: "text", text: errorText(err) }],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // list_named_graphs — discover named graphs
  // -----------------------------------------------------------------------
  server.tool(
    "list_named_graphs",
    "List named graphs in the dataset. " +
      "Call this before graph-scoped queries or updates.",
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .default(50)
        .describe("Maximum number of graphs to return (default: 50, max: 500)"),
    },
    async ({ limit }) => {
      const query = `SELECT DISTINCT ?g (COUNT(*) AS ?triples) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?triples) LIMIT ${limit}`;

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

  // -----------------------------------------------------------------------
  // search_fulltext — QLever text index search
  // -----------------------------------------------------------------------
  server.tool(
    "search_fulltext",
    "Search QLever's text index for entities co-occurring with keywords. " +
      "Different from search_entities which matches labels. Requires text index.",
    {
      keywords: z
        .string()
        .describe("Keywords to search for in the text index"),
      filter_type: z
        .string()
        .optional()
        .describe(
          "Optional type IRI to filter entities (e.g. '<http://www.wikidata.org/entity/Q5>' for humans)",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(1000)
        .optional()
        .default(20)
        .describe("Maximum number of results (default: 20, max: 1000)"),
    },
    async ({ keywords, filter_type, limit }) => {
      const escapedKeywords = keywords.replace(/"/g, '\\"');
      const typeFilter = filter_type
        ? `\n  ?entity a <${filter_type.replace(/^<|>$/g, "")}> .`
        : "";

      const query = `SELECT ?entity ?score ?text WHERE {
  ?text <ql:contains-entity> ?entity .
  ?text <ql:contains-word> "${escapedKeywords}" .${typeFilter}
  OPTIONAL { ?text <ql:text-score> ?score . }
} ORDER BY DESC(?score) LIMIT ${limit}`;

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

  // -----------------------------------------------------------------------
  // spatial_query — geographic search with radius or bounding box
  // -----------------------------------------------------------------------
  const spatialParams = z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("radius"),
      lat: z.number().describe("Latitude of the center point"),
      lon: z.number().describe("Longitude of the center point"),
      radius_km: z.number().positive().describe("Search radius in kilometers"),
      type_filter: z.string().optional().describe("Optional type IRI to filter entities"),
      coordinate_predicate: z
        .string()
        .optional()
        .default("<http://www.wikidata.org/prop/direct/P625>")
        .describe("Predicate for coordinates (default: wdt:P625)"),
      label_predicate: z
        .string()
        .regex(
          labelPredicateRegex,
          "Must be a prefixed name (e.g. 'rdfs:label') or a full IRI (e.g. '<http://...>')",
        )
        .optional()
        .default("rdfs:label")
        .describe("Predicate for labels (default: rdfs:label)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .default(100)
        .describe("Maximum results (default: 100, max: 10000)"),
    }),
    z.object({
      mode: z.literal("bbox"),
      min_lat: z.number().describe("Minimum latitude of bounding box"),
      max_lat: z.number().describe("Maximum latitude of bounding box"),
      min_lon: z.number().describe("Minimum longitude of bounding box"),
      max_lon: z.number().describe("Maximum longitude of bounding box"),
      type_filter: z.string().optional().describe("Optional type IRI to filter entities"),
      coordinate_predicate: z
        .string()
        .optional()
        .default("<http://www.wikidata.org/prop/direct/P625>")
        .describe("Predicate for coordinates (default: wdt:P625)"),
      label_predicate: z
        .string()
        .regex(
          labelPredicateRegex,
          "Must be a prefixed name (e.g. 'rdfs:label') or a full IRI (e.g. '<http://...>')",
        )
        .optional()
        .default("rdfs:label")
        .describe("Predicate for labels (default: rdfs:label)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .default(100)
        .describe("Maximum results (default: 100, max: 10000)"),
    }),
  ]);

  server.tool(
    "spatial_query",
    "Find entities within a geographic area using QLever's native spatial join. " +
      "Supports radius and bounding box modes.",
    { params: spatialParams },
    async ({ params }) => {
      const coordPred = params.coordinate_predicate;
      const labelPred = params.label_predicate;
      const typeFilter = params.type_filter
        ? `\n  ?entity a <${params.type_filter.replace(/^<|>$/g, "")}> .`
        : "";

      let query: string;

      if (params.mode === "radius") {
        query = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?entity ?label ?coord WHERE {
  ?entity ${coordPred} ?coord .${typeFilter}
  OPTIONAL { ?entity ${labelPred} ?label . }
  SERVICE <ql:spatialJoin> {
    ?entity <ql:spatialJoin:center> "POINT(${params.lon} ${params.lat})" .
    ?entity <ql:spatialJoin:maxDistance> "${params.radius_km}km" .
  }
} LIMIT ${params.limit}`;
      } else {
        query = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?entity ?label ?coord WHERE {
  ?entity ${coordPred} ?coord .${typeFilter}
  OPTIONAL { ?entity ${labelPred} ?label . }
  FILTER(
    geof:latitude(?coord) >= ${params.min_lat} && geof:latitude(?coord) <= ${params.max_lat} &&
    geof:longitude(?coord) >= ${params.min_lon} && geof:longitude(?coord) <= ${params.max_lon}
  )
} LIMIT ${params.limit}`;
      }

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

  // -----------------------------------------------------------------------
  // sparql_update — SPARQL 1.1 Update with safety checks
  // -----------------------------------------------------------------------
  server.tool(
    "sparql_update",
    "Execute a SPARQL 1.1 Update. REQUIRES access token. " +
      "Use dry_run:true to preview. Destructive operations (DROP ALL, CLEAR ALL) require confirm:true.",
    {
      update: z
        .string()
        .describe("The SPARQL Update statement to execute"),
      graph_uri: z
        .string()
        .optional()
        .describe("Optional target graph URI"),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe("Preview the update without executing (default: false)"),
      confirm: z
        .boolean()
        .optional()
        .default(false)
        .describe("Required for destructive operations like DROP ALL or CLEAR ALL"),
    },
    async ({ update, graph_uri, dry_run, confirm }) => {
      // Check access token
      if (!client.hasAccessToken) {
        return {
          content: [
            {
              type: "text",
              text: "SPARQL Update requires an access token. Set QLEVER_ACCESS_TOKEN or use --access-token.",
            },
          ],
          isError: true,
        };
      }

      // Dangerous operation detection
      const dangerousPattern = /DROP\s+(SILENT\s+)?ALL|CLEAR\s+(SILENT\s+)?ALL/i;
      if (dangerousPattern.test(update) && !confirm) {
        return {
          content: [
            {
              type: "text",
              text: "Destructive operation detected (DROP ALL or CLEAR ALL). " +
                "Set confirm: true to proceed. This operation cannot be undone.",
            },
          ],
          isError: true,
        };
      }

      // Dry run — parse the update type and summarize
      if (dry_run) {
        const upperUpdate = update.trim().toUpperCase();
        let updateType = "UNKNOWN";
        if (upperUpdate.startsWith("INSERT")) updateType = "INSERT";
        else if (upperUpdate.startsWith("DELETE")) updateType = "DELETE";
        else if (upperUpdate.startsWith("CLEAR")) updateType = "CLEAR";
        else if (upperUpdate.startsWith("DROP")) updateType = "DROP";
        else if (upperUpdate.startsWith("CREATE")) updateType = "CREATE";
        else if (upperUpdate.startsWith("LOAD")) updateType = "LOAD";
        else if (upperUpdate.startsWith("COPY")) updateType = "COPY";
        else if (upperUpdate.startsWith("MOVE")) updateType = "MOVE";
        else if (upperUpdate.startsWith("ADD")) updateType = "ADD";

        const lines = [
          `Dry run — update would NOT be executed.`,
          ``,
          `Update type: ${updateType}`,
          graph_uri ? `Target graph: ${graph_uri}` : `Target graph: default`,
          ``,
          `Statement:`,
          update,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // Execute
      try {
        const result = await client.update(update, { graphUri: graph_uri });
        return {
          content: [{ type: "text", text: `Update successful: ${result.message}` }],
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
