# Spectify + MCP OpenAPI Analyzer Integration Architecture

## Overview

This document describes the integration architecture between **Spectify** (linting orchestrator service) and **MCP OpenAPI Analyzer** (document management and analysis service).

**Key Principle**: **Independent services with graceful degradation**

## Architecture Principles

### 1. Service Independence

- **Spectify**: Standalone linting service (port 3003)
  - Simple `npm start` to launch
  - No knowledge of MCP
  - No orchestration logic
  - Just provides HTTP API for linting

- **MCP OpenAPI Analyzer**: Document management service (port 3002)
  - Knows about Spectify dependency
  - Handles Spectify integration
  - Owns orchestration logic
  - Can run with or without Spectify

### 2. Resilience Through Decoupling

**Problem**: If MCP spawns Spectify as a child process:
- Spectify's heavy CPU/memory usage affects MCP responsiveness
- Spectify crash can destabilize MCP
- Tight coupling makes independent scaling difficult
- MCP can't stay responsive during Spectify overload

**Solution**: Run as independent processes with graceful degradation:
- ✅ MCP stays responsive even if Spectify crashes
- ✅ Spectify can be restarted without affecting MCP
- ✅ Spectify overload doesn't impact MCP operations
- ✅ Clear separation of concerns
- ✅ Independent scaling and monitoring

### 3. Graceful Degradation

MCP should **not** fail-fast when Spectify is unavailable. Instead:

```typescript
// RECOMMENDED: Graceful degradation
if (config.spectify.enabled) {
  const health = await spectifyClient.healthCheck();
  if (!health.available) {
    logger.warn('⚠️  Spectify unavailable - linting features disabled');
    spectifyAvailable = false;  // Runtime flag
  } else {
    logger.info('✅ Spectify integration enabled');
    spectifyAvailable = true;
  }
}

// Later, in lint endpoint
app.post('/lint', async (req, res) => {
  if (!spectifyAvailable) {
    return res.status(503).json({
      error: 'Spectify service unavailable',
      message: 'Linting features temporarily disabled'
    });
  }
  // Submit to Spectify...
});
```

**Benefits:**
- MCP can start without Spectify
- MCP continues running if Spectify crashes
- Clear error messages to users
- Automatic reconnection when Spectify recovers

### 4. Who Owns What?

| Responsibility | Owner | Why |
|---|---|---|
| Document Upload | MCP | Core MCP feature |
| Document Storage | MCP | Manages datastore |
| Document Parsing | MCP | OpenAPI parsing logic |
| Document Querying | MCP | MCP tools use this |
| Lint Orchestration | Spectify | Core Spectify feature |
| Ruleset Management | Spectify | Spectify owns rulesets |
| Worker Pool | Spectify | Spectify internal |
| **Startup Logic** | **MCP** | MCP declares the dependency |
| **Lifecycle Management** | **MCP** | MCP owns integration config |
| **Error Handling** | **MCP** | MCP handles Spectify unavailability |

## Integration Patterns

### Pattern 1: MCP Launch Script (Recommended for Development)

```bash
#!/bin/bash
# mcp-openapi-analysis/scripts/start-with-spectify.sh

# Check if Spectify is configured
if [ "$SPECTIFY_ENABLED" != "true" ]; then
  echo "Starting MCP without Spectify..."
  npm start
  exit 0
fi

# Check if Spectify already running
if curl -s http://localhost:3003/health > /dev/null 2>&1; then
  echo "✅ Spectify already running"
else
  echo "Starting Spectify..."
  SPECTIFY_PATH="${SPECTIFY_PATH:-../spectify}"
  
  if [ ! -d "$SPECTIFY_PATH" ]; then
    echo "⚠️  Spectify not found at $SPECTIFY_PATH"
    echo "   MCP will start without Spectify (degraded mode)"
  else
    cd "$SPECTIFY_PATH"
    npm start > /tmp/spectify.log 2>&1 &
    SPECTIFY_PID=$!
    
    # Wait up to 30 seconds for health check
    for i in {1..30}; do
      if curl -s http://localhost:3003/health > /dev/null 2>&1; then
        echo "✅ Spectify ready (PID: $SPECTIFY_PID)"
        break
      fi
      if [ $i -eq 30 ]; then
        echo "⚠️  Spectify startup timeout - MCP will run degraded"
      fi
      sleep 1
    done
    
    cd - > /dev/null
  fi
fi

# Start MCP (connects to Spectify or runs degraded)
echo "Starting MCP..."
npm start
```

**Usage:**
```bash
cd mcp-openapi-analysis
export SPECTIFY_ENABLED=true
export SPECTIFY_PATH=../spectify
./scripts/start-with-spectify.sh
```

### Pattern 2: Process Manager (Recommended for Production)

#### Using pm2:

```javascript
// ecosystem.config.js (in mcp-openapi-analysis repo)
module.exports = {
  apps: [
    {
      name: 'spectify',
      script: 'build/index.js',
      cwd: '/opt/spectify',
      instances: 1,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        SPECTIFYD_DOCUMENT_STORE_TYPE: 'mcp',
        SPECTIFYD_DOCUMENT_STORE_DIR: '/opt/mcp-openapi-analysis/datastore/documents'
      }
    },
    {
      name: 'mcp-openapi-analysis',
      script: 'npm',
      args: 'start',
      cwd: '/opt/mcp-openapi-analysis',
      wait_ready: true,
      env: {
        NODE_ENV: 'production',
        SPECTIFY_ENABLED: 'true',
        SPECTIFY_BASE_URL: 'http://localhost:3003'
      }
    }
  ]
};
```

```bash
# Start both services
pm2 start ecosystem.config.js

# Restart Spectify without affecting MCP
pm2 restart spectify

# Monitor
pm2 status
pm2 logs
```

#### Using systemd:

```ini
# /etc/systemd/system/spectify.service
[Unit]
Description=Orchestrator Linting Service
After=network.target

[Service]
Type=simple
User=spectify
WorkingDirectory=/opt/spectify
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=SPECTIFYD_DOCUMENT_STORE_TYPE=mcp

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/mcp-openapi-analysis.service
[Unit]
Description=MCP OpenAPI Analysis Service
After=network.target
# Note: No Requires=spectify.service (graceful degradation)

[Service]
Type=simple
User=mcp
WorkingDirectory=/opt/mcp-openapi-analysis
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
Environment=SPECTIFY_ENABLED=true

[Install]
WantedBy=multi-user.target
```

```bash
# Start both (order doesn't matter due to graceful degradation)
sudo systemctl start spectify
sudo systemctl start mcp-openapi-analysis

# Or start MCP only (runs degraded)
sudo systemctl start mcp-openapi-analysis
```

### Pattern 3: Docker Compose

```yaml
version: '3.8'

services:
  spectify:
    image: spectify:latest
    container_name: spectify
    ports:
      - "3003:3003"
    environment:
      - NODE_ENV=production
      - SPECTIFYD_DOCUMENT_STORE_TYPE=mcp
      - SPECTIFYD_DOCUMENT_STORE_DIR=/shared/documents
    volumes:
      - shared-documents:/shared/documents
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    restart: unless-stopped

  mcp-openapi-analysis:
    image: mcp-openapi-analysis:latest
    container_name: mcp
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - SPECTIFY_ENABLED=true
      - SPECTIFY_BASE_URL=http://spectify:3003
    volumes:
      - shared-documents:/app/datastore/documents
    # Note: No depends_on required (graceful degradation)
    # But you CAN add it for startup order preference:
    depends_on:
      spectify:
        condition: service_healthy
        # If Spectify fails health check, MCP still starts (degraded)
    restart: unless-stopped

volumes:
  shared-documents:
```

**Start order doesn't matter:**
```bash
# Both work fine
docker-compose up spectify mcp-openapi-analysis
docker-compose up mcp-openapi-analysis spectify

# Or MCP only (degraded mode)
docker-compose up mcp-openapi-analysis
```

### Pattern 4: Kubernetes

```yaml
apiVersion: v1
kind: Service
metadata:
  name: spectify
spec:
  selector:
    app: spectify
  ports:
  - port: 3003
    targetPort: 3003
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spectify
spec:
  replicas: 2
  selector:
    matchLabels:
      app: spectify
  template:
    metadata:
      labels:
        app: spectify
    spec:
      containers:
      - name: spectify
        image: spectify:latest
        ports:
        - containerPort: 3003
        env:
        - name: NODE_ENV
          value: "production"
        - name: SPECTIFYD_DOCUMENT_STORE_TYPE
          value: "mcp"
        livenessProbe:
          httpGet:
            path: /health
            port: 3003
          initialDelaySeconds: 15
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3003
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "2000m"
            memory: "2Gi"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-openapi-analysis
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mcp
  template:
    metadata:
      labels:
        app: mcp
    spec:
      containers:
      - name: mcp
        image: mcp-openapi-analysis:latest
        ports:
        - containerPort: 3002
        env:
        - name: NODE_ENV
          value: "production"
        - name: SPECTIFY_ENABLED
          value: "true"
        - name: SPECTIFY_BASE_URL
          value: "http://spectify:3003"
        livenessProbe:
          httpGet:
            path: /health
            port: 3002
          initialDelaySeconds: 15
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3002
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            cpu: "200m"
            memory: "256Mi"
          limits:
            cpu: "1000m"
            memory: "512Mi"
```

**No initContainers needed** due to graceful degradation. If Spectify pods are not ready, MCP runs degraded.

## MCP Configuration

```yaml
# mcp-openapi-analysis/config.yaml
spectify:
  enabled: true  # Enable Spectify integration
  baseUrl: http://localhost:3003
  healthCheckTimeout: 5000
  retryInterval: 30000  # Retry connection every 30 seconds
  gracefulDegradation: true  # Don't fail-fast (recommended)
```

## MCP Implementation (Recommended)

```typescript
// mcp-openapi-analysis/src/index.ts

let spectifyAvailable = false;
let spectifyClient: SpectifyClient | null = null;

async function initializeSpectify() {
  if (!config.spectify.enabled) {
    logger.info('Spectify integration disabled');
    return;
  }

  spectifyClient = new SpectifyClient(config.spectify.baseUrl);

  // Try to connect
  try {
    const health = await spectifyClient.healthCheck({ 
      timeout: config.spectify.healthCheckTimeout 
    });
    
    if (health.available) {
      spectifyAvailable = true;
      logger.info('✅ Spectify integration enabled');
    } else {
      spectifyAvailable = false;
      logger.warn('⚠️  Spectify service unhealthy - linting features disabled');
    }
  } catch (error) {
    spectifyAvailable = false;
    logger.warn('⚠️  Spectify connection failed - linting features disabled', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Retry connection periodically
  if (config.spectify.retryInterval > 0) {
    setInterval(async () => {
      try {
        const wasAvailable = spectifyAvailable;
        const health = await spectifyClient!.healthCheck({ timeout: 5000 });
        spectifyAvailable = health.available;

        if (spectifyAvailable && !wasAvailable) {
          logger.info('✅ Spectify connection restored');
        } else if (!spectifyAvailable && wasAvailable) {
          logger.warn('⚠️  Spectify connection lost');
        }
      } catch (error) {
        if (spectifyAvailable) {
          spectifyAvailable = false;
          logger.warn('⚠️  Spectify connection lost');
        }
      }
    }, config.spectify.retryInterval);
  }
}

// During startup
async function startServer() {
  // Start MCP server first (doesn't depend on Spectify)
  const server = fastify();
  
  // Register routes, MCP tools, etc.
  registerRoutes(server);
  
  await server.listen({ port: 3002, host: '0.0.0.0' });
  logger.info('✅ MCP server listening on port 3002');
  
  // Try to connect to Spectify (non-blocking)
  await initializeSpectify();
  
  logger.info('🚀 MCP OpenAPI Analyzer ready');
}

// Lint endpoint with graceful degradation
server.post('/lint', async (request, reply) => {
  if (!spectifyAvailable || !spectifyClient) {
    return reply.status(503).send({
      error: 'ServiceUnavailable',
      message: 'Spectify linting service is currently unavailable',
      details: 'Linting features are temporarily disabled'
    });
  }

  try {
    const result = await spectifyClient.submitLintJob(request.body);
    return reply.send(result);
  } catch (error) {
    // If Spectify fails, mark as unavailable
    spectifyAvailable = false;
    throw error;
  }
});
```

## Spectify Implementation (Keep Simple)

```typescript
// spectify/src/index.ts

async function startServer() {
  const server = fastify();
  
  // Register routes
  registerRoutes(server);
  
  await server.listen({ port: 3003, host: '0.0.0.0' });
  logger.info('✅ Spectify listening on port 3003');
}

startServer().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
```

**That's it!** No orchestration logic, no companion mode handling, just a simple service.

## Deployment Scenarios

### Scenario 1: Development (Both Services)

```bash
# Terminal 1: Spectify
cd spectify
npm start

# Terminal 2: MCP
cd mcp-openapi-analysis
npm start
```

Or use MCP's launch script:
```bash
cd mcp-openapi-analysis
./scripts/start-with-spectify.sh
```

### Scenario 2: Development (MCP Only, Degraded)

```bash
# Just start MCP
cd mcp-openapi-analysis
export SPECTIFY_ENABLED=false
npm start

# Or with Spectify enabled but unavailable
export SPECTIFY_ENABLED=true
npm start
# ⚠️  Spectify connection failed - linting features disabled
```

### Scenario 3: Production (Both Services)

Use process manager (pm2/systemd) or container orchestration (Docker/K8s) as shown above.

### Scenario 4: Production (MCP Only)

```yaml
# config.yaml
spectify:
  enabled: false
```

MCP runs without linting features.

## Monitoring & Operations

### Health Checks

**Spectify:**
```bash
curl http://localhost:3003/health
# {"status": "healthy", "uptime": 12345, "version": "1.0.0"}
```

**MCP:**
```bash
curl http://localhost:3002/health
# {
#   "status": "healthy",
#   "uptime": 12345,
#   "spectify": {
#     "enabled": true,
#     "available": true,
#     "lastCheck": "2024-12-18T10:00:00Z"
#   }
# }
```

### Restart Operations

```bash
# Restart Spectify (MCP unaffected)
pm2 restart spectify

# Restart MCP (Spectify unaffected)
pm2 restart mcp-openapi-analysis

# Restart both
pm2 restart all
```

### Scaling

**Scale Spectify independently:**
```bash
# Docker
docker-compose up -d --scale spectify=3

# Kubernetes
kubectl scale deployment spectify --replicas=3

# Add load balancer in front of Spectify
```

**Scale MCP independently:**
```bash
kubectl scale deployment mcp-openapi-analysis --replicas=3
```

## Troubleshooting

### MCP starts but Spectify unavailable

**Symptom:**
```
⚠️  Spectify connection failed - linting features disabled
```

**Check:**
1. Is Spectify running? `curl http://localhost:3003/health`
2. Is the URL correct? Check `SPECTIFY_BASE_URL`
3. Network connectivity between services?

**Impact:** MCP works normally, linting returns 503

### Spectify crashes

**Impact:** MCP continues running, linting requests return 503

**Resolution:**
1. Spectify auto-restarts (if using pm2/systemd/Docker)
2. MCP auto-reconnects within 30 seconds
3. No manual intervention needed

### Both services crash

**Resolution:**
1. Process manager restarts both
2. Startup order doesn't matter (graceful degradation)

## Migration from Fail-Fast Behavior

If your MCP currently uses fail-fast (exits when Spectify unavailable):

### Step 1: Update MCP Code

Replace:
```typescript
if (!health.available) {
  process.exit(1);  // ❌ Old: fail-fast
}
```

With:
```typescript
if (!health.available) {
  spectifyAvailable = false;  // ✅ New: graceful
  logger.warn('⚠️  Spectify unavailable');
}
```

### Step 2: Update Configuration

Add graceful degradation config:
```yaml
spectify:
  enabled: true
  gracefulDegradation: true  # New option
  retryInterval: 30000
```

### Step 3: Update Deployment

Remove hard dependencies:
- Docker: Remove required `depends_on` (make it optional)
- K8s: Remove `initContainers`
- systemd: Remove `Requires=` (keep `After=` for preferred order)

### Step 4: Test Degraded Mode

```bash
# Start MCP without Spectify
cd mcp-openapi-analysis
npm start

# Verify MCP works (except linting)
curl http://localhost:3002/health
curl http://localhost:3002/documents

# Verify linting returns 503
curl http://localhost:3002/lint
# {"error": "ServiceUnavailable", ...}
```

## Summary

**Architecture Decision Records:**

1. ✅ **Spectify is simple** - No orchestration logic, just `npm start`
2. ✅ **MCP owns integration** - MCP handles Spectify lifecycle
3. ✅ **Graceful degradation** - MCP works without Spectify
4. ✅ **Independent processes** - No child process coupling
5. ✅ **Automatic reconnection** - MCP retries Spectify periodically
6. ✅ **Clear error messages** - Users know when linting unavailable

**For Developers:**
- Start both services in any order
- Use MCP's launch script for convenience
- Spectify crashes don't affect MCP

**For Operations:**
- Use process manager or orchestration platform
- Monitor both services independently
- Scale independently based on load
- No complex startup choreography needed

---

**Document Version:** 1.0  
**Last Updated:** December 2024  
**Maintained By:** DevX API Team
