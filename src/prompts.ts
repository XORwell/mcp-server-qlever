/**
 * MCP prompt definitions for QLever workflows.
 *
 * Provides guided workflows for dataset exploration and safe SPARQL updates.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "explore_dataset",
    "Step-by-step workflow for exploring an unknown QLever dataset",
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Follow this workflow to explore the QLever dataset:

1. Call get_index_stats to understand the dataset scale and available features.
2. Call get_predicates(limit=30) to see the most common schema elements.
3. Call list_named_graphs if the dataset may be multi-graph.
4. Use sparql_autocomplete to validate entity IRIs before writing queries.
5. Use analyze_query on complex queries before executing them.
6. Use search_fulltext (if text index is present) for keyword-based entity discovery.
7. Use spatial_query for geographic searches (if the dataset has coordinate data).

Start with step 1 now.`,
        },
      }],
    }),
  );

  server.prompt(
    "safe_update_workflow",
    "Validated workflow for SPARQL Update operations requiring access token",
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Follow this workflow to safely perform SPARQL Updates:

1. Call get_index_stats to confirm the dataset and check write access indicators.
2. Compose the SPARQL UPDATE statement.
3. Call sparql_update with dry_run: true to preview what would change.
4. Review the dry_run output carefully.
5. Call sparql_update with dry_run: false to execute (add confirm: true for destructive operations).

Start with step 1 now.`,
        },
      }],
    }),
  );
}
