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

# --- Choose path ---
echo "Choose one (they are alternatives):"
echo "  1) Quick setup — script sets up .env and deps; you then edit .env, run npm run ingest, npm run dev."
echo "  2) Step-by-step — show manual instructions only (same result, you run each step yourself)."
echo ""
read -r -p "Enter 1 or 2 [1]: " choice
choice="${choice:-1}"

if [ "$choice" = "2" ]; then
  echo ""
  echo "=============================================="
  echo "  Step-by-step setup (manual)"
  echo "=============================================="
  echo ""
  echo "1. Copy env and edit:"
  echo "   cp .env.example .env"
  echo "   # Edit .env: set OPENSEARCH_URL, OPENSEARCH_USER, OPENSEARCH_PASS (and LLM keys if needed)."
  echo ""
  echo "2. Install dependencies:"
  echo "   npm install"
  echo ""
  echo "3. Edit .env with your OpenSearch URL, user, and password (optional: LLM_API_KEY)."
  echo "4. Load sample data: npm run ingest  (or INGEST_FORCE=1 npm run ingest to replace index)"
  echo "5. Start the app: npm run dev — then open http://localhost:3002 in your browser."
  echo ""
  echo "Frontend config: apps/frontend/.env.local (show hidden files to see it)."
  echo ""
  exit 0
fi

# --- Quick setup ---
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
echo "  → Edit .env in a text editor: set OPENSEARCH_URL, OPENSEARCH_USER, OPENSEARCH_PASS (and optional LLM_API_KEY for Semantic/Advanced)."
echo ""

echo "Installing dependencies..."
npm install
echo "  ✓ npm install done"
echo ""

echo "Next steps (do in order):"
echo "  1. Edit .env with your OpenSearch URL, username, and password (and optional LLM_API_KEY)."
echo "  2. Load sample data:  npm run ingest"
echo "     (To replace existing data: INGEST_FORCE=1 npm run ingest)"
echo "  3. Start the app:      npm run dev"
echo "  4. Open in browser:    http://localhost:3002  (backend: http://localhost:3001)"
echo ""
echo "Frontend config: apps/frontend/.env.local (enable Show hidden files to see it)."
echo ""
echo "Quick setup finished. Complete the steps above to run the demo."
