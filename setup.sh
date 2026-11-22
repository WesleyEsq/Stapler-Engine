#!/usr/bin/env bash
set -euo pipefail

# Always run from the project root, even if invoked from elsewhere
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> Checking toolchain..."
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed (Node 18+ required)." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js 18+ is required (found $(node -v))." >&2
  exit 1
fi

echo "    Node $(node -v), npm $(npm -v)"

echo "==> Installing workspace dependencies..."
npm install

echo "==> Running TypeScript typecheck..."
npm run typecheck

echo "==> Running unit tests..."
npm test

echo "==> Running production build check..."
npm run build

echo ""
echo "Setup complete! Start the Milestone 1 dev server with:"
echo "  npm run dev"
