#!/bin/bash
set -e

echo "Starting local PostgreSQL service..."
brew services start postgresql@17 >/dev/null 2>&1 || true

echo "Starting Sift backend..."
cd /Users/christian/Projects/sift/backend
./dev.sh
