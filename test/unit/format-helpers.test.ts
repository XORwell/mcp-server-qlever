/**
 * Tests for shared formatting and sanitization helpers.
 *
 * Covers escapeSparqlString, sanitizeIri, PREDICATE_REGEX, formatResultAsText,
 * and errorText — the shared security and formatting layer.
 */

import { describe, it, expect } from "vitest";
import {
  escapeSparqlString,
  sanitizeIri,
  formatResultAsText,
  errorText,
  PREDICATE_REGEX,
} from "../../src/format-helpers.js";
import { QleverError, type QleverQueryResult } from "../../src/qlever-client.js";

// ---------------------------------------------------------------------------
// escapeSparqlString
// ---------------------------------------------------------------------------

describe("escapeSparqlString", () => {
  it("passes through safe strings unchanged", () => {
    expect(escapeSparqlString("hello world")).toBe("hello world");
    expect(escapeSparqlString("Albert Einstein")).toBe("Albert Einstein");
    expect(escapeSparqlString("café")).toBe("café");
  });

  it("escapes double quotes", () => {
    expect(escapeSparqlString('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes backslashes before quotes (order matters)", () => {
    // Input: foo\"  (backslash then quote)
    // Must become: foo\\\\"  (escaped backslash, escaped quote)
    // NOT: foo\\"  (which would close the literal)
    expect(escapeSparqlString('foo\\"')).toBe('foo\\\\\\"');
  });

  it("escapes lone backslash", () => {
    expect(escapeSparqlString("foo\\")).toBe("foo\\\\");
  });

  it("escapes newlines", () => {
    expect(escapeSparqlString("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(escapeSparqlString("line1\rline2")).toBe("line1\\rline2");
  });

  it("escapes tabs", () => {
    expect(escapeSparqlString("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("escapes combined injection attempt: backslash-quote breakout", () => {
    // The classic attack: input \\\" closes the string
    // Input literal bytes: \ \ "
    const attack = '\\\\"';
    const escaped = escapeSparqlString(attack);
    // After escaping: \\\\ \\\\ \\"  = six chars
    // The result inside "..." should NOT close the literal
    expect(escaped).not.toMatch(/[^\\]"/);  // no unescaped quote
  });

  it("escapes CRLF injection", () => {
    expect(escapeSparqlString("a\r\nb")).toBe("a\\r\\nb");
  });

  it("handles empty string", () => {
    expect(escapeSparqlString("")).toBe("");
  });

  it("handles string with only special chars", () => {
    expect(escapeSparqlString('"\\\n\r\t')).toBe('\\"\\\\\\n\\r\\t');
  });

  it("escapes unicode line separator U+2028", () => {
    expect(escapeSparqlString("a\u2028b")).toBe("a\\u2028b");
  });

  it("escapes unicode paragraph separator U+2029", () => {
    expect(escapeSparqlString("a\u2029b")).toBe("a\\u2029b");
  });

  it("strips control characters (NUL, BEL, etc.)", () => {
    expect(escapeSparqlString("a\x00b\x07c")).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// sanitizeIri
// ---------------------------------------------------------------------------

describe("sanitizeIri", () => {
  describe("full IRIs (with ://)", () => {
    it("wraps bare HTTP IRIs in angle brackets", () => {
      expect(sanitizeIri("http://example.org/test")).toBe("<http://example.org/test>");
    });

    it("wraps bare HTTPS IRIs", () => {
      expect(sanitizeIri("https://d-nb.info/gnd/4000196-9")).toBe(
        "<https://d-nb.info/gnd/4000196-9>",
      );
    });

    it("preserves already-bracketed IRIs", () => {
      expect(sanitizeIri("<http://example.org/test>")).toBe("<http://example.org/test>");
    });

    it("handles IRIs with fragments", () => {
      expect(sanitizeIri("http://www.w3.org/2000/01/rdf-schema#label")).toBe(
        "<http://www.w3.org/2000/01/rdf-schema#label>",
      );
    });

    it("handles URN-style IRIs", () => {
      expect(sanitizeIri("urn:isbn:0451450523")).toBe("<urn:isbn:0451450523>");
    });
  });

  describe("prefixed names", () => {
    it("passes through rdfs:label as-is", () => {
      expect(sanitizeIri("rdfs:label")).toBe("rdfs:label");
    });

    it("passes through schema:name", () => {
      expect(sanitizeIri("schema:name")).toBe("schema:name");
    });

    it("passes through wdt:P31", () => {
      expect(sanitizeIri("wdt:P31")).toBe("wdt:P31");
    });

    it("passes through prefixed names with dots and hyphens", () => {
      expect(sanitizeIri("my.onto:some-prop")).toBe("my.onto:some-prop");
    });
  });

  describe("slash handling", () => {
    it("wraps IRIs with / in local part (not valid SPARQL PN_LOCAL)", () => {
      // ns:foo/bar is not a valid prefixed name — / not in PN_LOCAL
      // sanitizeIri should treat it as a full IRI
      expect(sanitizeIri("ns:foo/bar")).toBe("<ns:foo/bar>");
    });
  });

  describe("injection prevention", () => {
    it("rejects IRI with > inside (closes angle bracket)", () => {
      expect(() =>
        sanitizeIri("http://example.org/test> } MALICIOUS { <http://x"),
      ).toThrow("illegal characters");
    });

    it("rejects IRI with spaces", () => {
      expect(() => sanitizeIri("http://example.org/test foo")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with newline", () => {
      expect(() => sanitizeIri("http://example.org/test\nfoo")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with backslash", () => {
      expect(() => sanitizeIri("http://example.org/test\\foo")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with backtick", () => {
      expect(() => sanitizeIri("http://example.org/test`foo")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with curly braces", () => {
      expect(() => sanitizeIri("http://example.org/{foo}")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with pipe", () => {
      expect(() => sanitizeIri("http://example.org/test|foo")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with caret", () => {
      expect(() => sanitizeIri("http://example.org/test^foo")).toThrow(
        "illegal characters",
      );
    });

    it("rejects bracketed IRI with injection payload", () => {
      expect(() =>
        sanitizeIri("<http://example.org/test> } DELETE { ?s ?p ?o"),
      ).toThrow(); // unclosed bracket or illegal chars
    });

    it("rejects unclosed angle bracket", () => {
      expect(() => sanitizeIri("<http://example.org/test")).toThrow(
        "does not end with '>'",
      );
    });

    it("rejects empty IRI", () => {
      expect(() => sanitizeIri("<>")).toThrow("IRI is empty");
    });

    it("rejects empty string", () => {
      expect(() => sanitizeIri("")).toThrow("IRI is empty");
    });

    it("rejects IRI with control characters", () => {
      expect(() => sanitizeIri("http://example.org/\x00test")).toThrow(
        "illegal characters",
      );
    });

    it("rejects IRI with tab", () => {
      expect(() => sanitizeIri("http://example.org/\ttest")).toThrow(
        "illegal characters",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// PREDICATE_REGEX
// ---------------------------------------------------------------------------

describe("PREDICATE_REGEX", () => {
  describe("valid predicates", () => {
    const valid = [
      "rdfs:label",
      "schema:name",
      "wdt:P31",
      "foaf:name",
      ":localName",
      "a:b",
      "ns_:prop",
      "my.onto:some-prop",
      "<http://www.w3.org/2000/01/rdf-schema#label>",
      "<http://schema.org/name>",
      "<https://d-nb.info/standards/elementset/gnd#preferredNameForTheWork>",
    ];

    for (const pred of valid) {
      it(`accepts "${pred}"`, () => {
        expect(PREDICATE_REGEX.test(pred)).toBe(true);
      });
    }
  });

  describe("invalid predicates", () => {
    const invalid = [
      "",
      "DROP ALL;",
      "rdfs:label # comment",
      "rdfs:label\n?x ?y ?z",
      "rdfs label",
      "<unclosed",
      "unclosed>",
      "rdfs:label\t?x",
      '<"; DELETE WHERE { ?s ?p ?o }',
      "rdfs:label . ?x ?y ?z } UNION { SELECT *",
      "<http://example.org/foo bar>",       // space inside IRI
      "<http://example.org/foo\nbar>",      // newline inside IRI
      "<http://example.org/foo\\bar>",      // backslash inside IRI
      "<>",                                  // empty IRI
    ];

    for (const pred of invalid) {
      it(`rejects "${pred.slice(0, 50).replace(/\n/g, "\\n")}"`, () => {
        expect(PREDICATE_REGEX.test(pred)).toBe(false);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// formatResultAsText
// ---------------------------------------------------------------------------

describe("formatResultAsText", () => {
  function makeResult(overrides: Partial<QleverQueryResult> = {}): QleverQueryResult {
    return {
      query: "(test)",
      status: "OK",
      warnings: [],
      selected: ["?s", "?p"],
      res: [["a", "b"], ["c", "d"]],
      resultSizeExported: 2,
      resultSizeTotal: 2,
      time: { total: "1ms", computeResult: "0ms" },
      ...overrides,
    };
  }

  it("formats a basic result table", () => {
    const text = formatResultAsText(makeResult());
    expect(text).toContain("?s\t?p");
    expect(text).toContain("a\tb");
    expect(text).toContain("c\td");
    expect(text).toContain("Showing 2 of 2 results (1ms)");
  });

  it("returns 'No results' for empty result set", () => {
    const text = formatResultAsText(makeResult({ res: [], resultSizeExported: 0 }));
    expect(text).toBe("No results. (1ms)");
  });

  it("escapes tab characters in cell values", () => {
    const text = formatResultAsText(
      makeResult({ res: [["val\twith\ttabs", "ok"]] }),
    );
    expect(text).toContain("val\\twith\\ttabs");
    // The escaped tabs should not break column alignment
    const lines = text.split("\n");
    const dataLine = lines[2]; // after header + separator
    expect(dataLine.split("\t").length).toBe(2);
  });

  it("handles separator line length matching header", () => {
    const text = formatResultAsText(
      makeResult({ selected: ["?longVariable", "?x"] }),
    );
    const lines = text.split("\n");
    expect(lines[1]).toBe("-".repeat("?longVariable".length) + "\t" + "-".repeat("?x".length));
  });
});

// ---------------------------------------------------------------------------
// errorText
// ---------------------------------------------------------------------------

describe("errorText", () => {
  it("formats QleverError with prefix", () => {
    expect(errorText(new QleverError("test error"))).toBe("QLever error: test error");
  });

  it("formats generic Error with prefix", () => {
    expect(errorText(new Error("generic"))).toBe("Error: generic");
  });

  it("formats non-Error values", () => {
    expect(errorText("string error")).toBe("Unknown error: string error");
    expect(errorText(42)).toBe("Unknown error: 42");
    expect(errorText(null)).toBe("Unknown error: null");
  });
});
