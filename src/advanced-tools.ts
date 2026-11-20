/**
 * Advanced MCP tool definitions for QLever-specific features.
 *
 * Provides predicate/class completion, query analysis, named graphs, full-text search,
 * spatial queries, and SPARQL Update support.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QleverClient } from "./qlever-client.js";
import {
  escapeSparqlString,
  sanitizeIri,
  formatResultAsText,
  errorText,
  PREDICATE_REGEX,
  inspectSparqlUpdate,
} from "./format-helpers.js";

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Render a number in plain decimal notation (no exponent) for SPARQL/WKT. */
function wktNumber(n: number): string {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/\.?0+$/, "") : s;
}

export function registerAdvancedTools(
  server: McpServer,
  client: QleverClient,
): void {
  // -----------------------------------------------------------------------
  // sparql_autocomplete — suggest predicates / classes that exist in the data
  // -----------------------------------------------------------------------
  server.tool(
    "sparql_autocomplete",
    "Use this BEFORE sparql_query when unsure which predicates or classes exist. " +
      "Suggests predicate or class IRIs from the dataset that contain the given text, " +
      "ordered by how often they are used. For entities, use search_entities.",
    {
      search_term: z
        .string()
        .describe(
          "Text to match (case-insensitive substring of the IRI), e.g. 'birth'. " +
            "Use an empty string to list the most frequent ones.",
        ),
      kind: z
        .enum(["predicate", "class"])
        .optional()
        .default("predicate")
        .describe("What to complete: 'predicate' (default) or 'class' (rdf:type objects)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of completions to return (default: 20, max: 100)"),
    },
    async ({ search_term, kind, limit }) => {
      const escaped = escapeSparqlString(search_term);
      const pattern =
        kind === "class"
          ? "?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?completion ."
          : "?s ql:has-predicate ?completion .";
      const filter = escaped
        ? `\n  FILTER(CONTAINS(LCASE(STR(?completion)), LCASE("${escaped}")))`
        : "";
      const query = `SELECT ?completion (COUNT(?completion) AS ?count) WHERE {
  ${pattern}${filter}
} GROUP BY ?completion ORDER BY DESC(?count) LIMIT ${limit}`;

      try {
        const result = await client.query(query, { maxRows: limit });

        if (result.res.length === 0) {
          return { content: [{ type: "text", text: "No completions found." }] };
        }

        const lines = result.res.map((row, i) => {
          const count = /^"(\d+)"/.exec(row[1] ?? "")?.[1] ?? row[1];
          return `${i + 1}. ${row[0]} (count: ${count})`;
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
  // analyze_query — executed query plan with sizes and timings
  // -----------------------------------------------------------------------
  server.tool(
    "analyze_query",
    "Analyze how QLever evaluates a SPARQL query. The query IS executed " +
      "(QLever has no plan-only mode) but no result rows are returned. " +
      "Shows the query execution tree with estimated vs. actual sizes, " +
      "per-operation timings and the total result size. " +
      "Use a short timeout for potentially expensive queries.",
    {
      query: z
        .string()
        .describe("The SPARQL query to analyze"),
      timeout: z
        .string()
        .regex(
          /^\d+(ns|us|ms|s|min|h)$/,
          "Must be a QLever duration (e.g. '30s', '5000ms', '2min')",
        )
        .optional()
        .describe("Query timeout (default: server-configured timeout)"),
    },
    async ({ query, timeout }) => {
      try {
        const analysis = await client.analyzeQuery(query, { timeout });
        return {
          content: [{ type: "text", text: JSON.stringify(analysis, null, 2) }],
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
      const escapedKeywords = escapeSparqlString(keywords);
      let typeFilter = "";
      if (filter_type) {
        const safeIri = sanitizeIri(filter_type);
        typeFilter = `\n  ?entity a ${safeIri} .`;
      }

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
      lat: z.number().finite().min(-90).max(90).describe("Latitude of the center point (-90 to 90)"),
      lon: z.number().finite().min(-180).max(180).describe("Longitude of the center point (-180 to 180)"),
      radius_km: z.number().finite().positive().describe("Search radius in kilometers"),
      type_filter: z.string().optional().describe("Optional type IRI to filter entities"),
      coordinate_predicate: z
        .string()
        .regex(
          PREDICATE_REGEX,
          "Must be a prefixed name or a full IRI (e.g. '<http://...>')",
        )
        .optional()
        .default("<http://www.wikidata.org/prop/direct/P625>")
        .describe("Predicate for coordinates (default: wdt:P625)"),
      label_predicate: z
        .string()
        .regex(
          PREDICATE_REGEX,
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
      min_lat: z.number().finite().min(-90).max(90).describe("Minimum latitude of bounding box (-90 to 90)"),
      max_lat: z.number().finite().min(-90).max(90).describe("Maximum latitude of bounding box (-90 to 90)"),
      min_lon: z.number().finite().min(-180).max(180).describe("Minimum longitude of bounding box (-180 to 180)"),
      max_lon: z.number().finite().min(-180).max(180).describe("Maximum longitude of bounding box (-180 to 180)"),
      type_filter: z.string().optional().describe("Optional type IRI to filter entities"),
      coordinate_predicate: z
        .string()
        .regex(
          PREDICATE_REGEX,
          "Must be a prefixed name or a full IRI (e.g. '<http://...>')",
        )
        .optional()
        .default("<http://www.wikidata.org/prop/direct/P625>")
        .describe("Predicate for coordinates (default: wdt:P625)"),
      label_predicate: z
        .string()
        .regex(
          PREDICATE_REGEX,
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
    "Find entities within a geographic area (GeoSPARQL geof: functions on WKT point literals). " +
      "Supports radius and bounding box modes.",
    { params: spatialParams },
    async ({ params }) => {
      const coordPred = params.coordinate_predicate;
      const labelPred = params.label_predicate;
      let typeFilter = "";
      if (params.type_filter) {
        const safeIri = sanitizeIri(params.type_filter);
        typeFilter = `\n  ?entity a ${safeIri} .`;
      }

      let query: string;

      if (params.mode === "radius") {
        // geof:distance returns kilometres in QLever.
        query = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?entity ?label ?coord ?distance_km WHERE {
  ?entity ${coordPred} ?coord .${typeFilter}
  BIND(geof:distance(?coord, "POINT(${wktNumber(params.lon)} ${wktNumber(params.lat)})"^^geo:wktLiteral) AS ?distance_km)
  FILTER(?distance_km <= ${wktNumber(params.radius_km)})
  OPTIONAL { ?entity ${labelPred} ?label . }
} ORDER BY ?distance_km LIMIT ${params.limit}`;
      } else {
        query = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?entity ?label ?coord WHERE {
  ?entity ${coordPred} ?coord .${typeFilter}
  OPTIONAL { ?entity ${labelPred} ?label . }
  FILTER(
    geof:latitude(?coord) >= ${wktNumber(params.min_lat)} && geof:latitude(?coord) <= ${wktNumber(params.max_lat)} &&
    geof:longitude(?coord) >= ${wktNumber(params.min_lon)} && geof:longitude(?coord) <= ${wktNumber(params.max_lon)}
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
      "Use dry_run:true to preview. dry_run:true only echoes the statement without contacting QLever. Any DROP or CLEAR requires confirm:true.",
    {
      update: z
        .string()
        .describe("The SPARQL Update statement to execute"),
      graph_uri: z
        .string()
        .optional()
        .describe(
          "Optional full graph IRI (e.g. '<http://example.org/graph>') used as the " +
            "default graph for the WHERE clause (SPARQL protocol using-graph-uri). " +
            "To write into a named graph, use GRAPH <...> { } in the statement itself.",
        ),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe("Show the detected operations and statement without executing (default: false)"),
      confirm: z
        .boolean()
        .optional()
        .default(false)
        .describe("Required for any DROP or CLEAR operation"),
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

      // Validate the graph IRI (full IRIs only — prefixed names cannot be resolved here)
      let graphIri: string | undefined;
      if (graph_uri !== undefined) {
        try {
          graphIri = sanitizeIri(graph_uri);
          if (!graphIri.startsWith("<")) {
            throw new Error("graph_uri must be a full IRI, not a prefixed name");
          }
        } catch (err) {
          return {
            content: [{ type: "text", text: errorText(err) }],
            isError: true,
          };
        }
      }

      // Destructive operation detection — any DROP or CLEAR removes whole
      // graphs. Comments, strings and IRIs are ignored so the check cannot be
      // bypassed (e.g. "DROP # x\n ALL") or triggered by literal text.
      const { operations, destructive } = inspectSparqlUpdate(update);
      if (destructive && !confirm) {
        return {
          content: [
            {
              type: "text",
              text: "Destructive operation detected (DROP or CLEAR removes entire graphs). " +
                "Set confirm: true to proceed. This operation cannot be undone.",
            },
          ],
          isError: true,
        };
      }

      // Dry run — summarize without sending anything to QLever
      if (dry_run) {
        const updateType = operations.length > 0 ? operations.join(", ") : "UNKNOWN";

        const lines = [
          `Dry run — update would NOT be executed.`,
          ``,
          `Update type: ${updateType}`,
          graphIri ? `Using graph: ${graphIri}` : `Using graph: default`,
          ``,
          `Statement:`,
          update,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // Execute
      try {
        const result = await client.update(update, { graphUri: graphIri });
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
