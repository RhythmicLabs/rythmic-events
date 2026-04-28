#!/bin/bash

# Test Redis setup script
# Initializes Redis with test data and configuration

echo "Setting up test Redis environment..."

# Wait for Redis to be ready
echo "Waiting for Redis to start..."
sleep 2

# Create test databases setup
redis-cli -a testpass -h localhost -p 6379 << 'EOF'
# Select test database
SELECT 0

# Set some initial test data
HMSET test:event:1 data '{"id":"test:event:1","type":"test.event","occurredOn":"2024-01-01T00:00:00.000Z","aggregateId":"test-agg","version":1}'
HMSET test:event:2 data '{"id":"test:event:2","type":"another.event","occurredOn":"2024-01-01T01:00:00.000Z","version":1}'

# Create test indexes
SADD test:type:test.event test:event:1 test:event:2
SADD test:type:another.event test:event:2
SADD test:aggregate:test-agg test:event:1

# Set TTL for testing
EXPIRE test:event:1 3600
EXPIRE test:event:2 3600
EXPIRE test:type:test.event 3600
EXPIRE test:type:another.event 3600
EXPIRE test:aggregate:test-agg 3600

SELECT 1
# Clear database 1 for clean testing
FLUSHDB

SELECT 2
# Setup database 2 with different test data
HMSET perf:event:1 data '{"id":"perf:event:1","type":"performance.test"}'
HMSET perf:event:2 data '{"id":"perf:event:2","type":"performance.test"}'
SADD perf:type:performance.test perf:event:1 perf:event:2

EOF

echo "Redis test environment initialized"
echo "Test databases:"
echo "  - DB 0: Basic event tests"
echo "  - DB 1: Clean testing database"
echo "  - DB 2: Performance tests"

# Test connectivity
if redis-cli -a testpass -h localhost -p 6379 ping | grep -q "PONG"; then
    echo "✅ Redis is ready for testing"
else
    echo "❌ Redis is not responding"
    exit 1
fi