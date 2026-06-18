# Orchestrator CLI (`spectify`)

Command-line interface for the linting orchestrator — quality assurance for API specifications.

## Installation

```bash
npm install
npm run build
npm link  # Make the 'spectify' command available globally
```

## Usage

### Lint an OpenAPI Document

Analyze an OpenAPI document against a ruleset. The CLI automatically:
1. Uploads your document to the orchestrator's document store
2. Submits a lint job
3. Polls for completion and displays results

```bash
spectify lint path/to/openapi.yaml

# Specify ruleset
spectify lint openapi.yaml --ruleset pubhub

# Show all issues (no limit)
spectify lint openapi.yaml --show-all
```

**Workflow:**
- Reads OpenAPI file (JSON or YAML)
- Uploads to the orchestrator server
- Submits lint job with document ID
- Polls status every 2 seconds
- Displays color-coded results
- Saves to history (~/.spectify/history.json)

**Output:**
- Color-coded severity indicators
- Issue summary (errors, warnings, info, hints)
- Top 20 issues (use `--show-all` for complete list)
- Results saved to history automatically

### Check Job Status

Monitor the progress of a lint job:

```bash
spectify status <jobId>

# Watch until completion
spectify status <jobId> --watch
```

### View Detailed Results

View complete lint results with filtering:

```bash
# View all results
spectify results <jobId>

# Filter by rule
spectify results <jobId> --rule success-status-code

# Filter by severity
spectify results <jobId> --severity error

# JSON output
spectify results <jobId> --format json
```

### View History

Access your lint history:

```bash
# Recent 10 entries
spectify history

# Recent 50 entries
spectify history --limit 50

# Filter by file
spectify history --file openapi.yaml

# Filter by ruleset
spectify history --ruleset pubhub

# Clear history
spectify history --clear
```

### List Rulesets

See available rulesets:

```bash
spectify rulesets

# JSON output
spectify rulesets --format json
```

### Health Check

Verify the orchestrator service is running:

```bash
spectify health

# JSON output
spectify health --format json
```

## Global Options

```
--api-url <url>    Orchestrator API URL (default: http://localhost:3003)
```

## Examples

### Basic Workflow

```bash
# 1. Check service health
spectify health

# 2. See available rulesets
spectify rulesets

# 3. Lint your document
spectify lint myapi.yaml --ruleset pubhub

# 4. View history
spectify history

# 5. View detailed results of a previous job
spectify results abc-123-def
```

### CI/CD Integration

```bash
#!/bin/bash
# Exit on first error
set -e

# Lint OpenAPI document
spectify lint api/openapi.yaml --ruleset pubhub

# Exit code:
# 0 = no errors
# 1 = errors found or service unavailable
```

### Different Environments

```bash
# Local
spectify lint openapi.yaml

# Staging
spectify lint openapi.yaml --api-url http://spectify-staging:3003

# Production
spectify lint openapi.yaml --api-url https://spectify.example.com
```

## History Storage

History is stored in `~/.spectify/history.json`:
- Last 100 lint operations
- File path, ruleset, timestamp
- Issue summary
- Job IDs for result retrieval

## Exit Codes

- `0`: Success (no errors found)
- `1`: Errors found or command failed

## Tips

1. **Use `--show-all` for complete results**: By default, only first 20 issues are shown
2. **Filter results by severity**: Quickly see only errors with `--severity error`
3. **Check history before re-running**: Results are cached, use history to find previous job IDs
4. **Watch mode for long jobs**: Use `--watch` to poll status until completion

## Troubleshooting

### "Orchestrator service is not responding"

Make sure the orchestrator service is running:

```bash
npm start
```

Or check specific URL:

```bash
spectify health --api-url http://localhost:3003
```

### "File not found"

Use absolute or relative path:

```bash
spectify lint ./api/openapi.yaml
spectify lint /home/user/project/openapi.yaml
```

### "Invalid OpenAPI document format"

Ensure your document is valid JSON or YAML:

```bash
# Test YAML syntax
yamllint openapi.yaml

# Test JSON syntax
jq . openapi.json
```

## Development

### Running Locally

```bash
# Build
npm run build

# Test CLI without global install
node build/cli/index.js --help

# Link for global access
npm link
```

### Adding New Commands

1. Create command file: `src/cli/commands/mycommand.ts`
2. Export command function with options interface
3. Register in `src/cli/index.ts`:
   ```typescript
   program
     .command('mycommand')
     .description('My command description')
     .action(async (options) => {
       await myCommand(options);
     });
   ```
4. Rebuild: `npm run build`

## See Also

- [CLI Design Document](../docs/CLI_DESIGN_SIMPLIFIED.md)
- [API Documentation](../docs/API.md)
- [Main README](../README.md)
