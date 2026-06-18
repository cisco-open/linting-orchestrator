/**
 * Web UI routes for browsing job results
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseAdapter } from '../database.js';
import type { JobStatus } from '../types.js';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

Handlebars.registerHelper('formatDuration', (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
});

Handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});

Handlebars.registerHelper('statusBadge', (status: string) => {
  const badges: Record<string, string> = {
    completed: '<span class="badge badge-success">✓ Completed</span>',
    failed: '<span class="badge badge-danger">✗ Failed</span>',
    timeout: '<span class="badge badge-warning">⏱ Timeout</span>',
  };
  return new Handlebars.SafeString(badges[status] || status);
});

Handlebars.registerHelper('severityBadge', (severity: number) => {
  const badges: Record<number, string> = {
    0: '<span class="badge badge-danger">Error</span>',
    1: '<span class="badge badge-warning">Warning</span>',
    2: '<span class="badge badge-info">Info</span>',
    3: '<span class="badge badge-hint">Hint</span>',
  };
  return new Handlebars.SafeString(badges[severity] || 'Unknown');
});

export async function registerWebRoutes(
  app: FastifyInstance,
  database: DatabaseAdapter
): Promise<void> {
  // Load templates
  const templatesDir = join(__dirname, '..', 'templates');
  const layoutTemplate = Handlebars.compile(
    readFileSync(join(templatesDir, 'layout.hbs'), 'utf-8')
  );
  const jobListTemplate = Handlebars.compile(
    readFileSync(join(templatesDir, 'job-list.hbs'), 'utf-8')
  );
  const jobDetailsTemplate = Handlebars.compile(
    readFileSync(join(templatesDir, 'job-details.hbs'), 'utf-8')
  );

  // Home page - Job listing
  app.get('/', async (request, reply) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      status?: string;
      search?: string;
    };

    const limit = parseInt(query.limit || '50', 10);
    const offset = parseInt(query.offset || '0', 10);
    
    const queryParams: {
      limit: number;
      offset: number;
      status?: JobStatus;
      search?: string;
    } = {
      limit,
      offset,
    };
    
    if (query.status && ['completed', 'failed', 'timeout'].includes(query.status)) {
      queryParams.status = query.status as JobStatus;
    }
    if (query.search) queryParams.search = query.search;

    try {
      const { jobs, total } = database.listJobs(queryParams);
      
      const content = jobListTemplate({
        jobs,
        totalJobs: total,
        limit,
        offset,
        hasNext: offset + limit < total,
        hasPrev: offset > 0,
        nextOffset: offset + limit,
        prevOffset: Math.max(0, offset - limit),
        filters: {
          status: query.status,
          search: query.search,
        },
      });

      const html = layoutTemplate({
        title: 'Linting Reports — Job Listing',
        content,
      });

      reply.type('text/html').send(html);
    } catch (error) {
      app.log.error({ error }, 'Failed to render job listing');
      reply.code(500).send('Internal Server Error');
    }
  });

  // Job details page
  app.get('/view/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    try {
      const job = database.getJobById(jobId);
      
      if (!job) {
        reply.code(404).type('text/html').send(
          layoutTemplate({
            title: 'Job Not Found',
            content: '<div class="error"><h1>404 - Job Not Found</h1><p>No job found with ID: ' + jobId + '</p></div>',
          })
        );
        return;
      }

      const content = jobDetailsTemplate({ job });
      const html = layoutTemplate({
        title: `Job ${jobId} — Linting Reports`,
        content,
      });

      reply.type('text/html').send(html);
    } catch (error) {
      app.log.error({ error, jobId }, 'Failed to render job details');
      reply.code(500).send('Internal Server Error');
    }
  });
}
