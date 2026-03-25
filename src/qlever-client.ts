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
  exception: string;
  query?: string;
}

export type QleverResult = QleverQueryResult | QleverErrorResult;

/** Index statistics returned by `?cmd=stats`. */
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

export class QleverClient {
  private readonly endpoint: string;
  private readonly accessToken?: string;
  private readonly defaultTimeout: string;

  constructor(options: QleverClientOptions) {
    // Strip trailing slash for consistency
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.accessToken = options.accessToken;
    this.defaultTimeout = options.defaultTimeout ?? "30s";
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
    const params = new URLSearchParams();
    params.set("query", query);
    params.set("timeout", opts?.timeout ?? this.defaultTimeout);
    if (opts?.maxRows !== undefined) {
      params.set("send", String(opts.maxRows));
    }

    const result = await this.post<QleverResult>(params, {
      accept: "application/qlever-results+json",
    });

    if (result.status === "ERROR") {
      throw new QleverError(result.exception, query);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Administrative commands
  // -------------------------------------------------------------------------

  /** Retrieve index statistics (dataset name, triple count, etc.). */
  async getIndexStats(): Promise<QleverIndexStats> {
    const url = new URL(this.endpoint);
    url.searchParams.set("cmd", "stats");
    const res = await this.fetch(url.toString(), {
      method: "GET",
      headers: this.baseHeaders(),
    });
    return this.parseJson<QleverIndexStats>(res);
  }

  /** Retrieve cache statistics. */
  async getCacheStats(): Promise<Record<string, unknown>> {
    const url = new URL(this.endpoint);
    url.searchParams.set("cmd", "cache-stats");
    const res = await this.fetch(url.toString(), {
      method: "GET",
      headers: this.baseHeaders(),
    });
    return this.parseJson<Record<string, unknown>>(res);
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
    const res = await this.fetch(this.endpoint, {
      method: "POST",
      headers,
      body: params.toString(),
    });
    return this.parseJson<T>(res);
  }

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const res = await globalThis.fetch(url, init);
    if (!res.ok && res.status !== 200) {
      const body = await res.text().catch(() => "(no body)");
      throw new QleverError(
        `HTTP ${res.status} ${res.statusText}: ${body}`,
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
