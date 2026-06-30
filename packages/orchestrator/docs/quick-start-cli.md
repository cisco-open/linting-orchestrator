# orchestrator CLI Quick Start

Get started with the orchestrator command-line interface in minutes.

---

## 📦 Installation

```bash
npm install -g @cisco_open/linting-orchestrator

# Verify installation
spectify --version
```

> **Contributors / maintainers:** For the source-based workflow, see [installation.md](installation.md).

---

## 🚀 Quick Start

### 1. Start the Server

The CLI requires a running orchestrator API server:

```bash
# In separate terminal
cd linting-orchestrator
npm start

# Or use standalone mode
npm run start:standalone
```

**Verify server is running:**
```bash
spectify health
# ✅ Spectify is healthy
```

### 2. Lint Your First Document

```bash
# Lint with all rulesets
spectify lint openapi.yaml

# Output:
# 📄 Analyzing: openapi.yaml
# 📤 Uploaded: doc-550e8400
# 🔍 Running rulesets: pubhub, spectral-oas, owasp...
# ✅ Analysis complete!
#
# Summary:
#   🚨 Errors: 2
#   ⚠️  Warnings: 5
#   ℹ️  Info: 12
```

### 3. Use Specific Rulesets

```bash
# Single ruleset
spectify lint openapi.yaml --ruleset pubhub

# Multiple rulesets
spectify lint openapi.yaml --ruleset pubhub --ruleset owasp

# Specific version
spectify lint openapi.yaml --ruleset pubhub:1.0.0
```

---

## 📋 Common Commands

### Lint Documents

```bash
# Default (all rulesets)
spectify lint api.yaml

# Specific ruleset
spectify lint api.yaml --ruleset pubhub

# Multiple rulesets
spectify lint api.yaml --ruleset pubhub --ruleset owasp

# JSON format output
spectify lint api.yaml --format json

# With specific server
spectify lint api.yaml --server http://localhost:4000

# Fail on errors only (exit code 1 if errors found)
spectify lint api.yaml --fail-on error
```

### List Rulesets

```bash
# List all available rulesets
spectify rulesets

# Output:
# Available Rulesets:
# 
# ┌──────────────┬─────────┬────────────────────────────────┐
# │ Name         │ Version │ Description                    │
# ├──────────────┼─────────┼────────────────────────────────┤
# │ pubhub       │ 1.1.0   │ PubHub Readiness Analyzer      │
# │ spectral-oas │ 6.11.0  │ Spectral OAS Rules             │
# │ owasp        │ 2.0.0   │ OWASP API Security Rules       │
# └──────────────┴─────────┴────────────────────────────────┘

# Get specific ruleset details
spectify rulesets pubhub

# List versions
spectify rulesets pubhub --versions
```

### View History

```bash
# Show recently uploaded documents
spectify history

# Output:
# Recent Documents:
# 
# ┌────────────┬─────────────┬──────────────────┬─────────┐
# │ ID         │ Filename    │ Uploaded         │ Size    │
# ├────────────┼─────────────┼──────────────────┼─────────┤
# │ doc-550e.. │ api.yaml    │ 5 minutes ago    │ 45 KB   │
# │ doc-7a3f.. │ petstore.ym │ 1 hour ago       │ 12 KB   │
# └────────────┴─────────────┴──────────────────┴─────────┘

# Show more entries
spectify history --limit 20
```

### Check Job Status

```bash
# Check specific job
spectify status job-123

# Get results when complete
spectify results job-123

# Get results in JSON format
spectify results job-123 --format json
```

### Health Check

```bash
# Check server health
spectify health

# With custom server
spectify health --server http://localhost:4000
```

---

## ⚙️ Configuration

### Default Server Configuration

The CLI auto-configures based on server mode:

```bash
# Check current config
spectify config

# Output:
# Current Configuration:
#   Mode: standalone
#   Server: http://localhost:3003
#   Default Ruleset: all
```

### Set Server Mode

```bash
# Set mode to standalone (default)
spectify config mode standalone
# Server URL: http://localhost:3003

# Set mode to mcp (companion mode)
spectify config mode mcp
# Server URL: http://localhost:3003
```

### Custom Server URL

```bash
# Set default server
spectify config server http://localhost:4000

# Or use --server flag
spectify lint api.yaml --server http://custom-server:3003
```

### Reset Configuration

```bash
# Reset to defaults
spectify config reset
```

---

## 🎯 Use Cases

### CI/CD Integration

```bash
#!/bin/bash
# .github/workflows/lint-openapi.sh

# Start server in background
spectify start --mode standalone &
SERVER_PID=$!

# Wait for server
sleep 5

# Lint documents
spectify lint openapi.yaml --fail-on error

# Capture exit code
EXIT_CODE=$?

# Stop server
kill $SERVER_PID

# Exit with lint status
exit $EXIT_CODE
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Find changed OpenAPI files
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.ya?ml$')

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

# Lint each file
for file in $CHANGED_FILES; do
  echo "Linting $file..."
  spectify lint "$file" --fail-on error || exit 1
done

echo "✅ All OpenAPI files passed linting"
exit 0
```

### Development Workflow

```bash
# Terminal 1: Start server
npm start

# Terminal 2: Watch and lint on changes
watch -n 5 'spectify lint api.yaml'

# Or use nodemon
nodemon --watch api.yaml --exec 'spectify lint api.yaml'
```

### Batch Processing

```bash
# Lint all OpenAPI files in directory
for file in specs/*.yaml; do
  echo "Linting $file"
  spectify lint "$file" --ruleset pubhub
done

# With parallel processing
find specs -name "*.yaml" | xargs -P 4 -I {} spectify lint {}
```

---

## 🔧 Advanced Usage

### Output Formats

```bash
# Human-readable (default)
spectify lint api.yaml

# JSON (for parsing)
spectify lint api.yaml --format json

# Table format
spectify lint api.yaml --format table

# JUnit XML (for CI)
spectify lint api.yaml --format junit
```

### Filtering Results

```bash
# Show only errors
spectify results job-123 --severity error

# Show errors and warnings
spectify results job-123 --severity error --severity warn

# Filter by rule
spectify results job-123 --rule oas3-schema
```

### Exit Codes

The CLI uses standard exit codes:

- `0` - Success (no issues or only info/warnings)
- `1` - Linting errors found
- `2` - Command failed (server unreachable, invalid input, etc.)

```bash
# Fail only on errors
spectify lint api.yaml --fail-on error
echo $?  # 0 if no errors, 1 if errors found

# Fail on warnings too
spectify lint api.yaml --fail-on warn
echo $?  # 0 if no warnings+, 1 if warnings/errors found
```

---

## 🐛 Troubleshooting

### Server Not Running

```bash
# Error: Cannot connect to Spectify server
# Fix: Start the server first
npm start  # In separate terminal
```

### Wrong Port

```bash
# If server runs on different port
spectify lint api.yaml --server http://localhost:4000

# Or configure permanently
spectify config server http://localhost:4000
```

### File Not Found

```bash
# Use absolute path
spectify lint /full/path/to/api.yaml

# Or relative to current directory
cd specs
spectify lint api.yaml
```

### API Caching

The API caches results by document content + ruleset:

```bash
# First run: Full analysis
spectify lint api.yaml
# ⏱️  5 seconds

# Second run: Cached (same file + ruleset)
spectify lint api.yaml
# ⚡ Instant!

# After editing file: New analysis
vim api.yaml
spectify lint api.yaml
# ⏱️  5 seconds (new content = new analysis)
```

---

## 📚 Complete Command Reference

### Global Options

```
--server, -s <url>     Spectify server URL (default: http://localhost:3003)
--help, -h             Show help
--version, -v          Show version
```

### Commands

```
lint <file>            Upload and analyze OpenAPI document
  --ruleset, -r        Specific ruleset(s) to run
  --format, -f         Output format (text|json|table|junit)
  --fail-on            Exit with error on: error|warn|info|never
  --timeout, -t        Job timeout in seconds

rulesets               List available rulesets
  --verbose, -v        Show detailed information
  --versions           Show all versions

history                Show upload history
  --limit, -n          Number of entries to show

status <jobId>         Check job status
results <jobId>        Get job results
  --format, -f         Output format
  --severity, -s       Filter by severity
  --rule, -r           Filter by rule

health                 Check server health
config [key] [value]   View or update configuration
  mode <standalone|mcp>  Set server mode
  server <url>           Set server URL
  reset                  Reset to defaults
version                Show CLI version
```

---

## 📖 Next Steps

- **API Server Quick Start:** [quick-start-api.md](quick-start-api.md) - Start the orchestrator server
- **Deployment Modes:** [deployment-modes.md](deployment-modes.md) - Understand CLI standalone vs. daemon modes
- **Ruleset Management:** [ruleset-management.md](ruleset-management.md) - Create custom rulesets
- **Integration Guide:** [internal/integrations/spectify-mcp.md](internal/integrations/spectify-mcp.md) - MCP integration

