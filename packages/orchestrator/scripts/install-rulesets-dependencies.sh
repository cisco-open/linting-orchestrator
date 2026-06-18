#!/bin/bash
# Install dependencies for all rulesets that have package.json
# This script runs npm install in each ruleset source directory

set -e

echo "🔍 Searching for rulesets with package.json..."

RULESET_DIR="$(dirname "$0")/../rulesets/sources"
FOUND=0
INSTALLED=0
FAILED=0

# Find all package.json files in ruleset directories (excluding node_modules)
while IFS= read -r -d '' package_file; do
  FOUND=$((FOUND + 1))
  ruleset_dir=$(dirname "$package_file")
  ruleset_name=$(basename "$(dirname "$(dirname "$ruleset_dir")")")/$(basename "$(dirname "$ruleset_dir")")/$(basename "$ruleset_dir")
  
  echo ""
  echo "📦 Installing dependencies for: $ruleset_name"
  echo "   Path: $ruleset_dir"
  
  if (cd "$ruleset_dir" && npm install); then
    INSTALLED=$((INSTALLED + 1))
    echo "   ✅ Successfully installed"
  else
    FAILED=$((FAILED + 1))
    echo "   ❌ Failed to install"
  fi
done < <(find "$RULESET_DIR" -name "package.json" -not -path "*/node_modules/*" -print0)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary:"
echo "   Found: $FOUND rulesets with package.json"
echo "   ✅ Installed: $INSTALLED"
echo "   ❌ Failed: $FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
