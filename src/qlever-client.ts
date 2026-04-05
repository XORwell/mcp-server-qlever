/**
 * QLever HTTP API client.
 *
 * Provides typed access to a QLever SPARQL engine instance, including
 * query execution, index statistics, and cache management.
 */

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** Time breakdown returned by QLever in the qlever-results+json format. */
export interface QleverTimings {
  total: string;
  computeResult: string;
  [key: string]: string;
}

/** Successful query result in qlever-results+json format. */
export interface QleverQueryResult {
  query: string;
  status: "OK";
  warnings: string[];
  selected: string[];
  res: string[][];
  resultSizeExported: number;
  resultSizeTotal: number;
  time: QleverTimings;
}

/** Error response from QLever. */
export interface QleverErrorResult {
  status: "ERROR";
  exception?: string;
  query?: string;
}

export type QleverResult = QleverQueryResult | QleverErrorResult;

/** Index statistics returned by `?cmd=stats` (normalized from QLever's kebab-case keys). */
export interface QleverIndexStats {
  name: string;
  numTriples: number;
  numPredicates: number;
  numSubjects: number;
  numObjects: number;
  description?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface QleverClientOptions {
  /** Full URL of the QLever API endpoint, e.g. https://qlever.cs.uni-freiburg.de/api/wikidata */
  endpoint: string;
  /** Optional access token for privileged operations. */
  accessToken?: string;
  /** Default query timeout (QLever duration format, e.g. "30s"). */
  defaultTimeout?: string;
}

const TIMEOUT_PATTERN = /^\d+(ns|us|ms|s|min|h)$/;
function validateTimeout(timeout: string): string {
  if (!TIMEOUT_PATTERN.test(timeout)) {
    throw new QleverError(
      `Invalid timeout format: "${timeout}". Expected: <number><unit> where unit is ns, us, ms, s, min, or h.`,
    );
  }
  return timeout;
}

export class QleverClient {
  private readonly _endpoint: string;
  private readonly _accessToken?: string;
  private readonly defaultTimeout: string;

  constructor(options: QleverClientOptions) {
    // Strip trailing slash for consistency
    this._endpoint = options.endpoint.replace(/\/+$/, "");
    this._accessToken = options.accessToken;
    this.defaultTimeout = options.defaultTimeout ?? "30s";
  }

  /** The configured QLever API endpoint URL. */
  get endpoint(): string {
    return this._endpoint;
  }

  // -------------------------------------------------------------------------
  // SPARQL queries
  // -------------------------------------------------------------------------

  /**
   * Execute a SPARQL query and return the parsed qlever-results+json response.
   *
   * @param query  - SPARQL query string
   * @param opts   - Optional overrides for timeout and max rows to export
   */
  async query(
    query: string,
    opts?: { timeout?: string; maxRows?: number },
  ): Promise<QleverQueryResult> {
    const timeout = validateTimeout(opts?.timeout ?? this.defaultTimeout);
    const params = new URLSearchParams();
    params.set("query", query);
    params.set("timeout", timeout);
    if (opts?.maxRows !== undefined) {
      params.set("send", String(opts.maxRows));
    }

    const result = await this.post<QleverResult>(params, {
      accept: "application/qlever-results+json",
    });

    if (result.status === "ERROR") {
      throw new QleverError(result.exception ?? "Unknown QLever error", query);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Administrative commands
  // -------------------------------------------------------------------------

  /** Retrieve index statistics (dataset name, triple count, etc.). */
  async getIndexStats(): Promise<QleverIndexStats> {
    const url = new URL(this._endpoint);
    url.searchParams.set("cmd", "stats");
    const res = await this.fetchUrl(url.toString(), {
      method: "GET",
      headers: this.baseHeaders(),
    });
    const raw = await this.parseJson<Record<string, unknown>>(res);

    // QLever returns kebab-case keys (e.g. "num-triples-normal").
    // Normalize to the camelCase QleverIndexStats interface while
    // preserving the original keys for direct access.
    return {
      ...raw,
      name: String(raw["name-index"] ?? ""),
      numTriples: Number(raw["num-triples-normal"] ?? 0),
      numPredicates: Number(raw["num-predicates-normal"] ?? 0),
      numSubjects: Number(raw["num-subjects-normal"] ?? 0),
      numObjects: Number(raw["num-objects-normal"] ?? 0),
    };
  }

  /** Retrieve cache statistics. */
  async getCacheStats(): Promise<Record<string, unknown>> {
    const url = new URL(this._endpoint);
    url.searchParams.set("cmd", "cache-stats");
    const res = await this.fetchUrl(url.toString(), {
      method: "GET",
      headers: this.baseHeaders(),
    });
    return this.parseJson<Record<string, unknown>>(res);
  }

  // -------------------------------------------------------------------------
  // Autocompletion
  // -------------------------------------------------------------------------

  /** Call QLever's /ac autocompletion endpoint. */
  async autocomplete(
    partialQuery: string,
    opts?: { context?: string; entityName?: string; limit?: number },
  ): Promise<{ completions: Array<{ text: string; score?: number }> }> {
    const url = new URL(this._endpoint);
    url.pathname = url.pathname.replace(/\/+$/, "") + "/ac";
    url.searchParams.set("q", partialQuery);
    if (opts?.context) url.searchParams.set("context", opts.context);
    if (opts?.entityName) url.searchParams.set("entity_name", opts.entityName);
    if (opts?.limit !== undefined) url.searchParams.set("limit", String(opts.limit));

    const res = await this.fetchUrl(url.toString(), {
      method: "GET",
      headers: this.baseHeaders(),
    });
    return this.parseJson<{ completions: Array<{ text: string; score?: number }> }>(res);
  }

  // -------------------------------------------------------------------------
  // Query analysis
  // -------------------------------------------------------------------------

  /** Analyze a SPARQL query plan without executing it. */
  async analyzeQuery(query: string): Promise<unknown> {
    const url = new URL(this._endpoint);
    url.searchParams.set("query", query);
    url.searchParams.set("action", "plan");

    const res = await this.fetchUrl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...this.baseHeaders(),
      },
    });

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // -------------------------------------------------------------------------
  // SPARQL Update
  // -------------------------------------------------------------------------

  /** Execute a SPARQL Update (requires access token). */
  async update(
    updateString: string,
    opts?: { graphUri?: string },
  ): Promise<{ success: boolean; message: string }> {
    if (!this._accessToken) {
      throw new QleverError(
        "SPARQL Update requires an access token. Set QLEVER_ACCESS_TOKEN or use --access-token.",
      );
    }

    const url = new URL(this._endpoint);
    if (opts?.graphUri) {
      url.searchParams.set("using-graph-uri", opts.graphUri);
    }

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      "Content-Type": "application/sparql-update",
    };

    const res = await this.fetchUrl(url.toString(), {
      method: "POST",
      headers,
      body: updateString,
    });

    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed.status === "ERROR") {
        throw new QleverError(parsed.exception ?? "Unknown QLever error", updateString);
      }
      return { success: true, message: parsed.message ?? "Update executed successfully." };
    } catch (err) {
      if (err instanceof QleverError) throw err;
      // Non-JSON response — treat as success if HTTP was OK
      return { success: true, message: text || "Update executed successfully." };
    }
  }

  /** Check if access token is configured. */
  get hasAccessToken(): boolean {
    return !!this._accessToken;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async post<T>(
    params: URLSearchParams,
    opts: { accept: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      Accept: opts.accept,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const res = await this.fetchUrl(this._endpoint, {
      method: "POST",
      headers,
      body: params.toString(),
    });
    return this.parseJson<T>(res);
  }

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this._accessToken) {
      headers["Authorization"] = `Bearer ${this._accessToken}`;
    }
    return headers;
  }

  /** Maximum time to wait for any HTTP response (60s). */
  private static readonly FETCH_TIMEOUT_MS = 60_000;

  private async fetchUrl(url: string, init: RequestInit): Promise<Response> {
    const res = await globalThis.fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(QleverClient.FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new QleverError(
        `HTTP ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
      );
    }
    return res;
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new QleverError(`Invalid JSON response: ${text.slice(0, 500)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class QleverError extends Error {
  readonly query?: string;

  constructor(message: string, query?: string) {
    super(message);
    this.name = "QleverError";
    this.query = query;
  }
}
