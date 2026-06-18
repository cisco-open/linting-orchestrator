// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * DocumentAccessor - Filesystem access to MCP document store
 * 
 * Provides minimal filesystem wrapper to access OpenAPI documents
 * stored by the MCP OpenAPI Analysis server. Uses direct filesystem
 * access for performance (zero-copy architecture).
 * 
 * Design: Workers receive file paths, not document content, to avoid
 * expensive serialization across thread boundaries.
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface DocumentAccessorConfig {
  /**
   * Path to MCP server's document upload directory
   * Example: '../mcp-openapi-analysis/uploads'
   */
  documentStorePath: string;

  /**
   * Fallback HTTP URL if file not found (optional)
   * Example: 'http://localhost:3002'
   */
  fallbackHttpUrl?: string;
}

export interface DocumentMetadata {
  documentId: string;
  filePath: string;
  exists: boolean;
  size?: number;
  createdAt?: Date;
  modifiedAt?: Date;
}

/**
 * DocumentAccessor - Direct filesystem access to MCP document store
 */
export class DocumentAccessor {
  private config: DocumentAccessorConfig;

  constructor(config: DocumentAccessorConfig) {
    this.config = config;
  }

  /**
   * Get absolute file path for a document ID
   * 
   * @param documentId - Document UUID from MCP server
   * @returns Absolute path to document JSON file
   */
  getDocumentPath(documentId: string): string {
    // MCP server stores documents as: uploads/{documentId}.json
    return path.resolve(this.config.documentStorePath, `${documentId}.json`);
  }

  /**
   * Check if document exists in filesystem
   * 
   * @param documentId - Document UUID
   * @returns True if file exists
   */
  async documentExists(documentId: string): Promise<boolean> {
    const filePath = this.getDocumentPath(documentId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get metadata about a document without loading content
   * 
   * @param documentId - Document UUID
   * @returns Document metadata including file stats
   */
  async getDocumentMetadata(documentId: string): Promise<DocumentMetadata> {
    const filePath = this.getDocumentPath(documentId);
    
    try {
      const stats = await fs.stat(filePath);
      return {
        documentId,
        filePath,
        exists: true,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    } catch (error) {
      return {
        documentId,
        filePath,
        exists: false,
      };
    }
  }

  /**
   * Load document content from filesystem
   * 
   * NOTE: Workers should use this directly in their threads to avoid
   * passing large document content across thread boundaries.
   * 
   * @param documentId - Document UUID
   * @returns Parsed OpenAPI document
   */
  async loadDocument(documentId: string): Promise<any> {
    const filePath = this.getDocumentPath(documentId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to load document ${documentId} from ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validate document store accessibility
   * 
   * @throws {Error} If document store directory is not accessible
   */
  async validateDocumentStore(): Promise<void> {
    try {
      await fs.access(this.config.documentStorePath);
      const stats = await fs.stat(this.config.documentStorePath);
      
      if (!stats.isDirectory()) {
        throw new Error(
          `Document store path is not a directory: ${this.config.documentStorePath}`
        );
      }
    } catch (error) {
      throw new Error(
        `Document store not accessible at ${this.config.documentStorePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * List all documents in the store
   * 
   * @returns Array of document IDs (without .json extension)
   */
  async listDocuments(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.config.documentStorePath);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      throw new Error(
        `Failed to list documents in ${this.config.documentStorePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get document store statistics
   */
  async getStoreStats(): Promise<{
    documentCount: number;
    totalSize: number;
    storePath: string;
  }> {
    const documents = await this.listDocuments();
    let totalSize = 0;

    for (const docId of documents) {
      const metadata = await this.getDocumentMetadata(docId);
      if (metadata.size) {
        totalSize += metadata.size;
      }
    }

    return {
      documentCount: documents.length,
      totalSize,
      storePath: this.config.documentStorePath,
    };
  }
}
