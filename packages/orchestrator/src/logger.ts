// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Structured Logging with Correlation IDs
 * 
 * Provides consistent logging format with request correlation
 */

import { randomUUID } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  jobId?: string;
  documentId?: string;
  rulesetName?: string;
  workerId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

class Logger {
  private level: LogLevel = 'info';
  private format: 'json' | 'text' = 'json';

  configure(level: LogLevel, format: 'json' | 'text' = 'json') {
    this.level = level;
    this.format = format;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatLog(entry: LogEntry): string {
    if (this.format === 'json') {
      return JSON.stringify(entry);
    }

    // Text format
    const timestamp = entry.timestamp;
    const level = entry.level.toUpperCase().padEnd(5);
    const correlationId = entry.context?.correlationId 
      ? `[${entry.context.correlationId.substring(0, 8)}]` 
      : '';
    
    let message = `${timestamp} ${level} ${correlationId} ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 1) {
      const ctx = { ...entry.context };
      delete ctx.correlationId;
      message += ` ${JSON.stringify(ctx)}`;
    }
    
    if (entry.error) {
      message += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\n${entry.error.stack}`;
      }
    }
    
    return message;
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    if (error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    }

    const formatted = this.formatLog(entry);
    
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext, error?: Error) {
    this.log('warn', message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error) {
    this.log('error', message, context, error);
  }
}

// Singleton instance
export const logger = new Logger();

// ============================================
// Correlation ID Management
// ============================================

export function generateCorrelationId(): string {
  return randomUUID();
}

export function createRequestContext(correlationId?: string): LogContext {
  return {
    correlationId: correlationId || generateCorrelationId()
  };
}

// ============================================
// Helper Functions
// ============================================

export function withContext(baseContext: LogContext, additionalContext: Partial<LogContext>): LogContext {
  return { ...baseContext, ...additionalContext };
}
