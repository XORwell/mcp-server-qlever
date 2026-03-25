#!/usr/bin/env bash
# Start the QLever test container, run tests, and tear down.
# Usage: ./scripts/test-container.sh

set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"

echo "Starting QLever test container..."
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "Running tests..."
npm test
TEST_EXIT=$?

echo "Stopping QLever test container..."
docker compose -f "$COMPOSE_FILE" down -v

exit $TEST_EXIT
