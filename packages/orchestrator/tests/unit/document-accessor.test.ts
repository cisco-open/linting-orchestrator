/**
 * Unit tests for DocumentAccessor
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DocumentAccessor } from '../../src/document-accessor.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('DocumentAccessor', () => {
  const testDocStorePath = './tests/fixtures/documents';
  const testDocId = 'test-doc-123';
  const testDocument = {
    openapi: '3.0.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    paths: {},
  };

  let accessor: DocumentAccessor;

  beforeAll(async () => {
    // Create test document store
    await fs.mkdir(testDocStorePath, { recursive: true });
    
    // Create a test document
    await fs.writeFile(
      path.join(testDocStorePath, `${testDocId}.json`),
      JSON.stringify(testDocument, null, 2)
    );

    accessor = new DocumentAccessor({
      documentStorePath: testDocStorePath,
    });
  });

  afterAll(async () => {
    // Cleanup test documents
    try {
      await fs.rm(testDocStorePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should create accessor successfully', () => {
      const acc = new DocumentAccessor({
        documentStorePath: testDocStorePath,
      });
      expect(acc).toBeDefined();
    });

    it('should accept fallback HTTP URL', () => {
      const acc = new DocumentAccessor({
        documentStorePath: testDocStorePath,
        fallbackHttpUrl: 'http://localhost:3002',
      });
      expect(acc).toBeDefined();
    });
  });

  describe('getDocumentPath', () => {
    it('should return absolute path for document ID', () => {
      const docPath = accessor.getDocumentPath(testDocId);
      
      expect(docPath).toBeTruthy();
      expect(path.isAbsolute(docPath)).toBe(true);
      expect(docPath).toContain(testDocId);
      expect(docPath).toMatch(/\.json$/);
    });

    it('should handle different document IDs', () => {
      const path1 = accessor.getDocumentPath('doc-1');
      const path2 = accessor.getDocumentPath('doc-2');
      
      expect(path1).not.toBe(path2);
      expect(path1).toContain('doc-1');
      expect(path2).toContain('doc-2');
    });

    it('should use .json extension', () => {
      const docPath = accessor.getDocumentPath('test-doc');
      expect(docPath).toMatch(/test-doc\.json$/);
    });
  });

  describe('documentExists', () => {
    it('should return true for existing document', async () => {
      const exists = await accessor.documentExists(testDocId);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent document', async () => {
      const exists = await accessor.documentExists('nonexistent-doc');
      expect(exists).toBe(false);
    });

    it('should be fast (no content reading)', async () => {
      const startTime = Date.now();
      await accessor.documentExists(testDocId);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(50); // Should be very fast
    });
  });

  describe('getDocumentMetadata', () => {
    it('should return metadata for existing document', async () => {
      const metadata = await accessor.getDocumentMetadata(testDocId);
      
      expect(metadata).toBeDefined();
      expect(metadata.documentId).toBe(testDocId);
      expect(metadata.exists).toBe(true);
      expect(metadata.filePath).toBeTruthy();
      expect(metadata.size).toBeGreaterThan(0);
      expect(metadata.createdAt).toBeInstanceOf(Date);
      expect(metadata.modifiedAt).toBeInstanceOf(Date);
    });

    it('should return metadata for non-existent document', async () => {
      const metadata = await accessor.getDocumentMetadata('nonexistent');
      
      expect(metadata).toBeDefined();
      expect(metadata.documentId).toBe('nonexistent');
      expect(metadata.exists).toBe(false);
      expect(metadata.filePath).toBeTruthy();
      expect(metadata.size).toBeUndefined();
      expect(metadata.createdAt).toBeUndefined();
    });

    it('should have correct file path', async () => {
      const metadata = await accessor.getDocumentMetadata(testDocId);
      expect(metadata.filePath).toContain(testDocId);
      expect(path.isAbsolute(metadata.filePath)).toBe(true);
    });

    it('should report realistic file size', async () => {
      const metadata = await accessor.getDocumentMetadata(testDocId);
      
      // Test document is small JSON
      expect(metadata.size).toBeGreaterThan(50);
      expect(metadata.size).toBeLessThan(1000);
    });
  });

  describe('loadDocument', () => {
    it('should load and parse existing document', async () => {
      const doc = await accessor.loadDocument(testDocId);
      
      expect(doc).toBeDefined();
      expect(doc.openapi).toBe('3.0.0');
      expect(doc.info.title).toBe('Test API');
      expect(doc.info.version).toBe('1.0.0');
    });

    it('should throw error for non-existent document', async () => {
      await expect(accessor.loadDocument('nonexistent')).rejects.toThrow();
    });

    it('should throw error for invalid JSON', async () => {
      const invalidDocId = 'invalid-json';
      await fs.writeFile(
        path.join(testDocStorePath, `${invalidDocId}.json`),
        'not valid json {'
      );
      
      await expect(accessor.loadDocument(invalidDocId)).rejects.toThrow();
      
      // Cleanup
      await fs.unlink(path.join(testDocStorePath, `${invalidDocId}.json`));
    });

    it('should return correct document structure', async () => {
      const doc = await accessor.loadDocument(testDocId);
      
      expect(typeof doc).toBe('object');
      expect(doc).toHaveProperty('openapi');
      expect(doc).toHaveProperty('info');
      expect(doc).toHaveProperty('paths');
    });
  });

  describe('validateDocumentStore', () => {
    it('should validate accessible document store', async () => {
      await expect(accessor.validateDocumentStore()).resolves.not.toThrow();
    });

    it('should throw error for non-existent directory', async () => {
      const badAccessor = new DocumentAccessor({
        documentStorePath: '/nonexistent/path/to/documents',
      });
      
      await expect(badAccessor.validateDocumentStore()).rejects.toThrow();
    });

    it('should throw error if path is a file, not directory', async () => {
      // Create a file instead of directory
      const filePath = './tests/fixtures/not-a-directory.txt';
      await fs.writeFile(filePath, 'test content');
      
      const badAccessor = new DocumentAccessor({
        documentStorePath: filePath,
      });
      
      await expect(badAccessor.validateDocumentStore()).rejects.toThrow('not a directory');
      
      // Cleanup
      await fs.unlink(filePath);
    });
  });

  describe('listDocuments', () => {
    it('should list all documents in store', async () => {
      const docs = await accessor.listDocuments();
      
      expect(Array.isArray(docs)).toBe(true);
      expect(docs).toContain(testDocId);
    });

    it('should return only JSON files', async () => {
      // Create a non-JSON file
      await fs.writeFile(path.join(testDocStorePath, 'readme.txt'), 'test');
      
      const docs = await accessor.listDocuments();
      
      expect(docs.every(id => !id.includes('.txt'))).toBe(true);
      expect(docs.every(id => !id.endsWith('.json'))).toBe(true); // IDs don't have extension
      
      // Cleanup
      await fs.unlink(path.join(testDocStorePath, 'readme.txt'));
    });

    it('should return document IDs without .json extension', async () => {
      const docs = await accessor.listDocuments();
      
      for (const docId of docs) {
        expect(docId).not.toMatch(/\.json$/);
      }
    });

    it('should return empty array for empty directory', async () => {
      const emptyPath = './tests/fixtures/empty-docs';
      await fs.mkdir(emptyPath, { recursive: true });
      
      const emptyAccessor = new DocumentAccessor({
        documentStorePath: emptyPath,
      });
      
      const docs = await emptyAccessor.listDocuments();
      expect(docs).toEqual([]);
      
      // Cleanup
      await fs.rmdir(emptyPath);
    });
  });

  describe('getStoreStats', () => {
    it('should return store statistics', async () => {
      const stats = await accessor.getStoreStats();
      
      expect(stats).toBeDefined();
      expect(stats.documentCount).toBeGreaterThanOrEqual(1);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.storePath).toBeTruthy();
    });

    it('should count documents correctly', async () => {
      const docs = await accessor.listDocuments();
      const stats = await accessor.getStoreStats();
      
      expect(stats.documentCount).toBe(docs.length);
    });

    it('should calculate total size', async () => {
      const stats = await accessor.getStoreStats();
      
      // At least the test document size
      expect(stats.totalSize).toBeGreaterThan(50);
    });

    it('should include store path', async () => {
      const stats = await accessor.getStoreStats();
      
      expect(stats.storePath).toContain('fixtures');
      expect(stats.storePath).toContain('documents');
    });
  });

  describe('edge cases', () => {
    it('should handle document IDs with special characters', () => {
      const specialIds = [
        'doc-with-dashes',
        'doc_with_underscores',
        'doc.with.dots',
        'doc123with456numbers',
      ];
      
      for (const docId of specialIds) {
        const path = accessor.getDocumentPath(docId);
        expect(path).toContain(docId);
      }
    });

    it('should handle concurrent document existence checks', async () => {
      const promises = Array(10).fill(null).map(() => 
        accessor.documentExists(testDocId)
      );
      
      const results = await Promise.all(promises);
      expect(results.every(r => r === true)).toBe(true);
    });

    it('should handle concurrent document loads', async () => {
      const promises = Array(5).fill(null).map(() => 
        accessor.loadDocument(testDocId)
      );
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      expect(results.every(doc => doc.openapi === '3.0.0')).toBe(true);
    });

    it('should handle large document ID', async () => {
      const longId = 'a'.repeat(200);
      const path = accessor.getDocumentPath(longId);
      expect(path).toContain(longId);
    });
  });

  describe('performance', () => {
    it('should check existence quickly', async () => {
      const startTime = Date.now();
      await accessor.documentExists(testDocId);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(50);
    });

    it('should get metadata quickly', async () => {
      const startTime = Date.now();
      await accessor.getDocumentMetadata(testDocId);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(100);
    });

    it('should list documents reasonably fast', async () => {
      const startTime = Date.now();
      await accessor.listDocuments();
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(200);
    });
  });
});
