#!/bin/bash
# Add a new ruleset source to Spectify
# Automates: clone → clean → install dependencies → guide registration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCES_DIR="$PROJECT_ROOT/rulesets/sources"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Spectify Ruleset Addition Tool${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Interactive mode if no arguments provided
if [ $# -eq 0 ]; then
  echo -e "${YELLOW}Interactive Mode${NC}"
  echo ""
  
  read -p "Repository URL: " REPO_URL
  read -p "Domain (e.g., github.com, wwwin-github.cisco.com): " DOMAIN
  read -p "Organization (e.g., CiscoDevNet, DevNet): " ORG
  read -p "Repository name: " REPO_NAME
  read -p "Version/tag/date (e.g., v1.0.0, 2026-02-05): " VERSION
  read -p "Branch or tag to clone (default: main): " BRANCH
  BRANCH=${BRANCH:-main}
else
  # Command-line mode
  REPO_URL=$1
  DOMAIN=$2
  ORG=$3
  REPO_NAME=$4
  VERSION=$5
  BRANCH=${6:-main}
fi

# Validate inputs
if [ -z "$REPO_URL" ] || [ -z "$DOMAIN" ] || [ -z "$ORG" ] || [ -z "$REPO_NAME" ] || [ -z "$VERSION" ]; then
  echo -e "${RED}❌ Error: All parameters are required${NC}"
  echo ""
  echo "Usage: $0 <repo-url> <domain> <org> <repo-name> <version> [branch]"
  echo ""
  echo "Example:"
  echo "  $0 https://github.com/CiscoDevNet/api-insights-openapi-rulesets \\"
  echo "     github.com CiscoDevNet api-insights-openapi-rulesets 2026-02-05"
  exit 1
fi

TARGET_DIR="$SOURCES_DIR/$DOMAIN/$ORG/$REPO_NAME/$VERSION"

echo ""
echo -e "${BLUE}Configuration:${NC}"
echo "  Repository:  $REPO_URL"
echo "  Domain:      $DOMAIN"
echo "  Organization: $ORG"
echo "  Repo Name:   $REPO_NAME"
echo "  Version:     $VERSION"
echo "  Branch:      $BRANCH"
echo "  Target:      $TARGET_DIR"
echo ""

# Check if directory already exists
if [ -d "$TARGET_DIR" ]; then
  echo -e "${YELLOW}⚠️  Warning: Directory already exists!${NC}"
  read -p "Overwrite? (y/N): " CONFIRM
  if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  rm -rf "$TARGET_DIR"
fi

# Step 1: Clone repository
echo ""
echo -e "${BLUE}📥 Step 1: Cloning repository...${NC}"
mkdir -p "$TARGET_DIR"
git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TARGET_DIR" 2>&1 | sed 's/^/   /'

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Failed to clone repository${NC}"
  exit 1
fi
echo -e "${GREEN}   ✅ Repository cloned${NC}"

# Step 2: Clean git metadata
echo ""
echo -e "${BLUE}🧹 Step 2: Cleaning git metadata and CI/CD files...${NC}"
cd "$TARGET_DIR"

if [ -d ".git" ]; then
  rm -rf .git
  echo -e "${GREEN}   ✅ Removed .git folder${NC}"
fi

if [ -d ".github" ]; then
  rm -rf .github
  echo -e "${GREEN}   ✅ Removed .github folder${NC}"
fi

# Remove other CI/CD files
for file in .gitlab-ci.yml .circleci .travis.yml azure-pipelines.yml; do
  if [ -e "$file" ]; then
    rm -rf "$file"
    echo -e "${GREEN}   ✅ Removed $file${NC}"
  fi
done

# Step 3: Install dependencies
echo ""
echo -e "${BLUE}📦 Step 3: Installing dependencies...${NC}"
if [ -f "package.json" ]; then
  npm install 2>&1 | grep -E '(added|audited|up to date)' | sed 's/^/   /'
  echo -e "${GREEN}   ✅ Dependencies installed${NC}"
else
  echo -e "${YELLOW}   ⚠️  No package.json found - skipping dependency installation${NC}"
fi

# Step 4: Verify structure
echo ""
echo -e "${BLUE}🔍 Step 4: Verifying structure...${NC}"
echo -e "${GREEN}   ✅ Source directory created at:${NC}"
echo "      $TARGET_DIR"
echo ""
echo "   Contents:"
ls -la "$TARGET_DIR" | head -20 | sed 's/^/      /'

# Step 5: Guide registration
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Ruleset source added successfully!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo ""
echo "1. Register the ruleset in configuration:"
echo "   Edit: $PROJECT_ROOT/rulesets/config/rulesets.yaml"
echo ""
echo "   Add entry:"
echo "   ---"
echo "   rulesets:"
echo "     - id: $REPO_NAME"
echo "       name: ${REPO_NAME^}"
echo "       description: [Add description]"
echo "       source:"
echo "         type: filesystem"
echo "         path: sources/$DOMAIN/$ORG/$REPO_NAME/$VERSION/[main-file].yaml"
echo "       defaultVersion: latest"
echo "       versions:"
echo "         - version: \"$VERSION\""
echo "           spectralFile: [main-file].yaml"
echo ""
echo "2. Document the source:"
echo "   Edit: $SOURCES_DIR/README.md"
echo ""
echo "3. Verify installation:"
echo "   cd $PROJECT_ROOT"
echo "   npm run check-rulesets"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
