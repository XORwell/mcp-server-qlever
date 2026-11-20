/**
 * Shared formatting and sanitization helpers for MCP tool handlers.
 */

import { QleverError, type QleverQueryResult } from "./qlever-client.js";

// ---------------------------------------------------------------------------
// SPARQL sanitization
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe interpolation inside a SPARQL double-quoted literal.
 * Handles backslashes, quotes, and control characters that would break
 * single-line string literals or allow injection.
 */
export function escapeSparqlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")       // backslashes first (order matters)
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\u2028/g, "\\u2028") // line separator (treated as newline by some parsers)
    .replace(/\u2029/g, "\\u2029") // paragraph separator
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // strip remaining control chars
}

/**
 * Validate and wrap an IRI for safe use in a SPARQL query.
 * Accepts full IRIs (`<http://...>` or bare `http://...`) and prefixed names
 * (`rdfs:label`). Rejects characters that could break out of an IRI reference.
 *
 * Returns the IRI ready for interpolation (wrapped in angle brackets if needed).
 */
export function sanitizeIri(iri: string): string {
  // Already angle-bracketed: validate and return
  if (iri.startsWith("<")) {
    if (!iri.endsWith(">")) {
      throw new Error("IRI starts with '<' but does not end with '>'");
    }
    const content = iri.slice(1, -1);
    validateIriContent(content);
    return iri;
  }

  // Full IRI (contains ://): wrap in angle brackets
  if (iri.includes("://")) {
    validateIriContent(iri);
    return `<${iri}>`;
  }

  // Prefixed name: prefix:localPart — pass through as-is
  // No / allowed in local part (SPARQL PN_LOCAL does not permit unescaped /)
  if (/^[a-zA-Z_][a-zA-Z0-9_.\-]*:[a-zA-Z0-9_.\-]*$/.test(iri)) {
    return iri;
  }

  // Anything else: treat as full IRI, wrap and validate
  validateIriContent(iri);
  return `<${iri}>`;
}

function validateIriContent(content: string): void {
  if (content.length === 0) {
    throw new Error("IRI is empty");
  }
  // RFC 3987 / SPARQL spec: reject characters illegal in IRI references
  if (/[<>"{}|\\^`\s\x00-\x1F\x7F]/.test(content)) {
    throw new Error(`IRI contains illegal characters: ${content}`);
  }
}

/**
 * Regex for validating label/coordinate predicates in tool parameters.
 * Matches prefixed names (rdfs:label) or full IRIs (<http://...>) with
 * strict character validation to prevent injection.
 */
export const PREDICATE_REGEX =
  /^([a-zA-Z_][a-zA-Z0-9_.]*:[a-zA-Z0-9_.\-]*|:[a-zA-Z0-9_.\-]+|<[a-zA-Z][a-zA-Z0-9+\-.]*:[^\s<>"{}|\\^`\x00-\x1F]+>)$/;

// ---------------------------------------------------------------------------
// SPARQL Update inspection
// ---------------------------------------------------------------------------

/**
 * Return the SPARQL text with IRIs, string literals and comments blanked out,
 * so keyword checks cannot be fooled by (or hidden behind) their contents.
 */
export function stripSparqlLiteralsAndComments(sparql: string): string {
  let out = "";
  let i = 0;
  while (i < sparql.length) {
    const rest = sparql.slice(i);
    const iri = /^<[^<>"{}|^`\\\s]*>/.exec(rest);
    if (iri) {
      out += " <> ";
      i += iri[0].length;
      continue;
    }
    const str =
      /^"""[\s\S]*?"""/.exec(rest) ??
      /^'''[\s\S]*?'''/.exec(rest) ??
      /^"(?:[^"\\\n]|\\.)*"/.exec(rest) ??
      /^'(?:[^'\\\n]|\\.)*'/.exec(rest);
    if (str) {
      out += ' "" ';
      i += str[0].length;
      continue;
    }
    if (sparql[i] === "#") {
      const end = sparql.indexOf("\n", i);
      i = end === -1 ? sparql.length : end;
      out += " ";
      continue;
    }
    out += sparql[i];
    i++;
  }
  return out;
}

const UPDATE_KEYWORDS = [
  "INSERT", "DELETE", "CLEAR", "DROP", "CREATE", "LOAD", "COPY", "MOVE", "ADD", "WITH",
] as const;

/**
 * Summarize a SPARQL Update: the operation keywords it contains (in order)
 * and whether it removes whole graphs (any DROP or CLEAR).
 */
export function inspectSparqlUpdate(update: string): {
  operations: string[];
  destructive: boolean;
} {
  const text = stripSparqlLiteralsAndComments(update).toUpperCase();
  const operations: string[] = [];
  for (const m of text.matchAll(/\b[A-Z]+\b/g)) {
    const word = m[0] as (typeof UPDATE_KEYWORDS)[number];
    // "DELETE { } INSERT { }" is one operation; don't report INSERT twice in a row.
    if (UPDATE_KEYWORDS.includes(word) && operations[operations.length - 1] !== word) {
      operations.push(word);
    }
  }
  return {
    operations,
    destructive: operations.includes("DROP") || operations.includes("CLEAR"),
  };
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

/** Format a QLever query result as a human-readable text table. */
export function formatResultAsText(result: QleverQueryResult): string {
  const { selected, res, resultSizeExported, resultSizeTotal, time } = result;

  if (res.length === 0) {
    return `No results. (${time.total})`;
  }

  const lines: string[] = [];

  // Header
  lines.push(selected.join("\t"));
  lines.push(selected.map((h) => "-".repeat(h.length)).join("\t"));

  // Rows — escape tabs in cell values to preserve column alignment
  for (const row of res) {
    lines.push(row.map((cell) => cell.replace(/\t/g, "\\t")).join("\t"));
  }

  // Footer
  lines.push("");
  lines.push(
    `Showing ${resultSizeExported} of ${resultSizeTotal} results (${time.total})`,
  );

  return lines.join("\n");
}

/** Wrap tool handler errors into user-friendly messages. */
export function errorText(err: unknown): string {
  if (err instanceof QleverError) {
    return `QLever error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Unknown error: ${String(err)}`;
}
