/**
 * Advanced MCP tool definitions for QLever-specific features.
 *
 * Provides autocompletion, query analysis, named graphs, full-text search,
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
} from "./format-helpers.js";

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
        .describe("Additional context for autocompletion (e.g. surrounding query text)"),
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
        const plan = await client.analyzeQuery(query);
        const text = typeof plan === "string" ? plan : JSON.stringify(plan, null, 2);
        return { content: [{ type: "text", text }] };
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
    "Find entities within a geographic area using QLever's native spatial join. " +
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
      "Use dry_run:true to preview. Destructive operations (DROP/CLEAR on ALL, DEFAULT, NAMED) require confirm:true.",
    {
      update: z
        .string()
        .describe("The SPARQL Update statement to execute"),
      graph_uri: z
        .string()
        .regex(
          PREDICATE_REGEX,
          "Must be a prefixed name or a full IRI (e.g. '<http://...>')",
        )
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

      // Dangerous operation detection — covers ALL, DEFAULT, NAMED targets
      const dangerousPattern = /\b(DROP|CLEAR)\s+(SILENT\s+)?(ALL|DEFAULT|NAMED)\b/i;
      if (dangerousPattern.test(update) && !confirm) {
        return {
          content: [
            {
              type: "text",
              text: "Destructive operation detected (DROP/CLEAR on ALL, DEFAULT, or NAMED). " +
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
