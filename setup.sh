#!/usr/bin/env bash
# Next-Gen Location Search — Setup script (Quick or Manual)

set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "=============================================="
echo "  Next-Gen Location Search — Setup"
echo "=============================================="
echo ""

# --- Prerequisite checks and installs ---
check_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ -n "$ver" ] && [ "$ver" -ge 18 ] 2>/dev/null; then
      echo "  ✓ Node.js $(node -v) (>= 18)"
      return 0
    fi
  fi
  echo "  ✗ Node.js 18+ not found or version too old."
  return 1
}

install_node() {
  echo "  Attempting to install Node.js 18+..."
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.nvm/nvm.sh"
    if nvm install 18 2>/dev/null; then
      nvm use 18
      echo "  ✓ Node.js installed via nvm: $(node -v)"
      return 0
    fi
  fi
  if command -v brew &>/dev/null; then
    if brew install node 2>/dev/null; then
      echo "  ✓ Node.js installed via Homebrew: $(node -v)"
      return 0
    fi
  fi
  echo "  Could not install Node.js automatically."
  echo "  Install manually: https://nodejs.org/ or run: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
  return 1
}

echo "Checking prerequisites..."
if ! check_node; then
  install_node || exit 1
fi
echo ""

echo "=============================================="
echo "  Quick setup"
echo "=============================================="
echo ""

if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✓ Created .env from .env.example"
else
  echo "  ✓ .env already exists (unchanged)"
fi
echo ""
echo "  → Edit .env with your OpenSearch and optional LLM settings:"
echo "     • OPENSEARCH_URL   — OpenSearch endpoint (no trailing slash)."
echo "     • OPENSEARCH_USER  — Username (e.g. ibmlhapikey_you@example.com for watsonx.data)."
echo "     • OPENSEARCH_PASS  — Password or API key."
echo "     • LLM_API_KEY      — Optional; needed for Semantic search and embeddings during ingest."
echo ""

echo "Installing dependencies..."
npm install
echo "  ✓ npm install done"
echo ""

echo "Next steps (do in order):"
echo "  1. Edit .env: set OPENSEARCH_URL (no trailing slash), OPENSEARCH_USER, OPENSEARCH_PASS."
echo "  2. Load sample data:   npm run ingest"
echo "     (To replace existing index: INGEST_FORCE=1 npm run ingest)"
echo "  3. Build packages:     npm run build:packages   (required before first dev run)"
echo "  4. Start the app:      npm run dev"
echo "  5. Open in browser:    http://localhost:3002   (backend: http://localhost:3001)"
echo ""
echo "  Frontend config: apps/frontend/.env.local (enable Show hidden files to see it)."
echo ""
echo "  Using IBM watsonx.data or managed OpenSearch? Use OPENSEARCH_USER and OPENSEARCH_PASS"
echo "  (the app expects these names). Ensure the URL has no trailing slash."
echo ""
echo "Quick setup finished. Complete the steps above to run the demo."
