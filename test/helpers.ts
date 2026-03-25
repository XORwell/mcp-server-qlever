/**
 * Shared test helpers for QLever MCP server tests.
 */

import { QleverClient } from "../src/qlever-client.js";

/** Default endpoint for the local QLever test container. */
export const TEST_ENDPOINT =
  process.env.QLEVER_TEST_ENDPOINT ?? "http://localhost:7019";

/** Create a QleverClient configured for the test container. */
export function createTestClient(): QleverClient {
  return new QleverClient({
    endpoint: TEST_ENDPOINT,
    defaultTimeout: "10s",
  });
}

/**
 * Check whether the QLever test container is reachable.
 * Returns true if a connection can be made, false otherwise.
 */
export async function isQleverAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${TEST_ENDPOINT}/?cmd=stats`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Vitest helper: skip the test if QLever container is not running.
 * Use as: const describeWithQlever = await containerSuite();
 */
export async function containerSuite() {
  const available = await isQleverAvailable();
  if (!available) {
    console.warn(
      "⚠ QLever container not available — skipping integration tests.\n" +
        "  Start it with: docker compose -f docker-compose.test.yml up -d --wait",
    );
  }
  return available;
}

/** Known entity IRIs in the test dataset. */
export const ENTITIES = {
  EINSTEIN: "http://example.org/Albert_Einstein",
  CURIE: "http://example.org/Marie_Curie",
  NEWTON: "http://example.org/Isaac_Newton",
  LOVELACE: "http://example.org/Ada_Lovelace",
  TESLA: "http://example.org/Nikola_Tesla",
} as const;

/** Known predicates in the test dataset. */
export const PREDICATES = {
  TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  LABEL: "http://www.w3.org/2000/01/rdf-schema#label",
  BIRTH_YEAR: "http://example.org/birthYear",
  FIELD: "http://example.org/field",
  AWARD: "http://example.org/award",
  BIRTH_PLACE: "http://example.org/birthPlace",
  KNOWN_FOR: "http://example.org/knownFor",
} as const;
