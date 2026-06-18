#!/bin/bash
# Check if all ruleset dependencies are properly installed
# This script verifies node_modules exist for each package.json

set -e

echo "🔍 Checking ruleset dependencies..."

RULESET_DIR="$(dirname "$0")/../rulesets/sources"
FOUND=0
INSTALLED=0
MISSING=0

# Find all package.json files in ruleset directories (excluding nested node_modules)
while IFS= read -r -d '' package_file; do
  FOUND=$((FOUND + 1))
  ruleset_dir=$(dirname "$package_file")
  ruleset_name=$(basename "$(dirname "$(dirname "$ruleset_dir")")")/$(basename "$(dirname "$ruleset_dir")")/$(basename "$ruleset_dir")
  node_modules="$ruleset_dir/node_modules"
  
  if [ -d "$node_modules" ]; then
    # Check if node_modules has content (more than just .bin and .package-lock.json)
    module_count=$(find "$node_modules" -maxdepth 1 -type d ! -name "node_modules" ! -name ".bin" | wc -l)
    if [ "$module_count" -gt 1 ]; then
      INSTALLED=$((INSTALLED + 1))
      echo "✅ $ruleset_name"
    else
      MISSING=$((MISSING + 1))
      echo "❌ $ruleset_name (node_modules empty)"
    fi
  else
    MISSING=$((MISSING + 1))
    echo "❌ $ruleset_name (node_modules missing)"
  fi
done < <(find "$RULESET_DIR" -name "package.json" -not -path "*/node_modules/*" -print0)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary:"
echo "   Found: $FOUND rulesets with package.json"
echo "   ✅ Installed: $INSTALLED"
echo "   ❌ Missing: $MISSING"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $MISSING -gt 0 ]; then
  echo ""
  echo "⚠️  Some rulesets are missing dependencies!"
  echo "   Run: npm run install-rulesets"
  exit 1
fi

echo ""
echo "✅ All ruleset dependencies are installed!"
