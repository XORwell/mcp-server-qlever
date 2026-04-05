/**
 * Lightweight HTTP mock for QLever API responses.
 *
 * Used in unit tests to avoid depending on a running QLever container.
 * Starts a real HTTP server on a random port so we test actual fetch() calls.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { URL } from "node:url";

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

type RequestHandler = (
  method: string,
  url: URL,
  body: string,
) => MockResponse | Promise<MockResponse>;

export class MockQleverServer {
  private server: Server;
  private handler: RequestHandler;
  private _port = 0;
  private _url = "";

  constructor(handler: RequestHandler) {
    this.handler = handler;
    this.server = createServer((req, res) => this.onRequest(req, res));
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return this._url;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          this._url = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Replace the handler at runtime (e.g. to simulate errors). */
  setHandler(handler: RequestHandler): void {
    this.handler = handler;
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf-8");
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this._port}`);

    try {
      const mock = await this.handler(req.method ?? "GET", url, body);
      const statusCode = mock.status ?? 200;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...mock.headers,
      };
      res.writeHead(statusCode, headers);
      res.end(typeof mock.body === "string" ? mock.body : JSON.stringify(mock.body));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
}

// ---------------------------------------------------------------------------
// Predefined mock responses matching QLever's qlever-results+json format
// ---------------------------------------------------------------------------

export function mockQueryResult(opts: {
  selected: string[];
  res: string[][];
  totalResults?: number;
  totalTime?: string;
}): MockResponse {
  return {
    body: {
      query: "(mock)",
      status: "OK",
      warnings: [],
      selected: opts.selected,
      res: opts.res,
      resultSizeExported: opts.res.length,
      resultSizeTotal: opts.totalResults ?? opts.res.length,
      resultsize: opts.totalResults ?? opts.res.length,
      time: {
        total: opts.totalTime ?? "1ms",
        computeResult: "0ms",
      },
    },
  };
}

export function mockErrorResult(message: string): MockResponse {
  return {
    body: {
      status: "ERROR",
      exception: message,
    },
  };
}

export function mockStatsResult(overrides?: Record<string, unknown>): MockResponse {
  // Matches real QLever `?cmd=stats` response format (kebab-case keys).
  // The client normalizes these to camelCase in getIndexStats().
  const defaults: Record<string, unknown> = {
    "name-index": "test-index",
    "num-triples-normal": 42,
    "num-predicates-normal": 7,
    "num-subjects-normal": 14,
    "num-objects-normal": 30,
    "num-triples-internal": 0,
    "num-predicates-internal": 0,
    "num-subjects-internal": 0,
    "num-objects-internal": 0,
  };

  // Support both kebab-case and camelCase keys in overrides for convenience.
  const mapped: Record<string, unknown> = {};
  const keyMap: Record<string, string> = {
    name: "name-index",
    numTriples: "num-triples-normal",
    numPredicates: "num-predicates-normal",
    numSubjects: "num-subjects-normal",
    numObjects: "num-objects-normal",
  };
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      mapped[keyMap[k] ?? k] = v;
    }
  }

  return {
    body: { ...defaults, ...mapped },
  };
}
