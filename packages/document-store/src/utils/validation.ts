/**
 * Validation utilities for document store
 */

/**
 * Validate document ID format (UUID v4)
 * Prevents path traversal attacks
 */
export function isValidDocumentId(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
}

/**
 * Validate and sanitize filename
 * Removes path separators and null bytes
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\]/g, '_')     // Replace path separators
    .replace(/\0/g, '')          // Remove null bytes
    .replace(/\.\./g, '__')      // Replace .. with __
    .trim();
}

/**
 * Validate OpenAPI document structure
 */
export function isValidOpenAPIDocument(doc: any): boolean {
  if (!doc || typeof doc !== 'object') {
    return false;
  }
  
  // Must have openapi or swagger field
  if (!doc.openapi && !doc.swagger) {
    return false;
  }
  
  // Must have info object
  if (!doc.info || typeof doc.info !== 'object') {
    return false;
  }
  
  return true;
}

/**
 * Validate file format
 */
export function isValidFormat(format: string): format is 'json' | 'yaml' {
  return format === 'json' || format === 'yaml';
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/**
 * Calculate SHA-256 checksum
 */
import { createHash } from 'crypto';

export function calculateChecksum(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}
