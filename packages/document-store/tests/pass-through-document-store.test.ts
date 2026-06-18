import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PassThroughDocumentStore } from '../build/adapters/pass-through-document-store.js';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_EXTERNAL_DIR = './test-external-uploads';
const SAMPLE_OPENAPI = {
  openapi: '3.0.0',
  info: {
    title: 'External API',
    version: '1.0.0'
  },
  servers: [
    { url: 'https://api.example.com' }
  ],
  paths: {
    '/external': {
      get: {
        summary: 'External endpoint',
        responses: {
          '200': {
            description: 'Success'
          }
        }
      }
    }
  }
};

describe('PassThroughDocumentStore', () => {
  let store: PassThroughDocumentStore;
  let testDocumentId: string;

  beforeAll(async () => {
    // Clean up and create test directory
    try {
      await fs.rm(TEST_EXTERNAL_DIR, { recursive: true, force: true });
    } catch {}
    
    await fs.mkdir(TEST_EXTERNAL_DIR, { recursive: true });

    // Create a test document in the external directory
    testDocumentId = '550e8400-e29b-41d4-a716-446655440000';
    const documentPath = path.join(TEST_EXTERNAL_DIR, `${testDocumentId}.json`);
    await fs.writeFile(documentPath, JSON.stringify(SAMPLE_OPENAPI, null, 2), 'utf-8');

    // Initialize the store
    store = new PassThroughDocumentStore({
      uploadsDir: TEST_EXTERNAL_DIR
    });

    await store.initialize();
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_EXTERNAL_DIR, { recursive: true, force: true });
    } catch {}
  });

  it('should initialize successfully', async () => {
    expect(store).toBeDefined();
  });

  it('should throw error when uploadsDir does not exist', async () => {
    const invalidStore = new PassThroughDocumentStore({
      uploadsDir: './non-existent-directory'
    });

    await expect(invalidStore.initialize()).rejects.toThrow('Uploads directory not found');
  });

  it('should throw error when trying to store a document', async () => {
    await expect(
      store.storeDocument('{}', 'json', { filename: 'test.json' })
    ).rejects.toThrow('PassThroughDocumentStore is read-only');
  });

  it('should retrieve document from external directory', async () => {
    const doc = await store.getDocument(testDocumentId);
    
    expect(doc).toBeDefined();
    expect(doc?.id).toBe(testDocumentId);
    expect(doc?.content.info.title).toBe('External API');
    expect(doc?.content.openapi).toBe('3.0.0');
    expect(doc?.metadata.openApiVersion).toBe('3.0.0');
  });

  it('should return undefined for non-existent document', async () => {
    const doc = await store.getDocument('00000000-0000-0000-0000-000000000000');
    expect(doc).toBeUndefined();
  });

  it('should check document existence', async () => {
    const exists = await store.documentExists(testDocumentId);
    expect(exists).toBe(true);

    const notExists = await store.documentExists('00000000-0000-0000-0000-000000000000');
    expect(notExists).toBe(false);
  });

  it('should reject invalid document IDs', async () => {
    const invalidExists = await store.documentExists('invalid-id');
    expect(invalidExists).toBe(false);

    await expect(
      store.getDocument('invalid-id')
    ).rejects.toThrow('Invalid document ID format');

    await expect(
      store.getDocumentPath('../../../etc/passwd')
    ).rejects.toThrow('Invalid document ID format');
  });

  it('should get document path', async () => {
    const filePath = await store.getDocumentPath(testDocumentId);
    
    expect(filePath).toContain(testDocumentId);
    expect(filePath).toContain('.json');
    // Path is resolved to absolute path, so just check it contains the directory name
    expect(filePath).toContain('test-external-uploads');

    // Verify file exists at returned path
    await fs.access(filePath);
  });

  it('should throw error for non-existent document path', async () => {
    await expect(
      store.getDocumentPath('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow('Document 00000000-0000-0000-0000-000000000000 not found');
  });

  it('should list documents in external directory', async () => {
    const docs = await store.listDocuments({ limit: 10 });
    
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty('id');
    expect(docs[0]).toHaveProperty('filename');
    
    // Should find our test document
    const foundDoc = docs.find(d => d.id === testDocumentId);
    expect(foundDoc).toBeDefined();
  });

  it('should validate document ID format', () => {
    // Valid UUID v4
    expect(store.isValidDocumentId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    
    // Invalid formats
    expect(store.isValidDocumentId('invalid-id')).toBe(false);
    expect(store.isValidDocumentId('not-a-uuid')).toBe(false);
    expect(store.isValidDocumentId('../../../etc/passwd')).toBe(false);
    expect(store.isValidDocumentId('')).toBe(false);
  });

  it('should get storage statistics', async () => {
    const stats = await store.getStats();
    
    expect(stats.totalDocuments).toBeGreaterThan(0);
    expect(stats.totalSize).toBeGreaterThan(0);
    // uploadsDir is not included in getStats for PassThrough
    expect(stats.quotaUsedPercent).toBeUndefined();
  });

  it('should handle search functionality', async () => {
    const results = await store.searchDocuments('External');
    
    // Should find documents with "External" in metadata
    expect(results.length).toBeGreaterThan(0);
    // SearchResult includes score and matchedFields, not metadata property directly
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('matchedFields');
  });

  it('should throw error when trying to update document', async () => {
    await expect(
      store.updateDocument(testDocumentId, '{}', 'json', { filename: 'test.json' })
    ).rejects.toThrow('read-only');
  });

  it('should throw error when trying to delete document', async () => {
    await expect(
      store.deleteDocument(testDocumentId)
    ).rejects.toThrow('read-only');
  });

  it('should handle multiple documents in directory', async () => {
    // Create additional test documents
    const doc2Id = '550e8400-e29b-41d4-a716-446655440001';
    const doc3Id = '550e8400-e29b-41d4-a716-446655440002';
    
    await fs.writeFile(
      path.join(TEST_EXTERNAL_DIR, `${doc2Id}.json`),
      JSON.stringify({ ...SAMPLE_OPENAPI, info: { ...SAMPLE_OPENAPI.info, title: 'API Two' } }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(TEST_EXTERNAL_DIR, `${doc3Id}.json`),
      JSON.stringify({ ...SAMPLE_OPENAPI, info: { ...SAMPLE_OPENAPI.info, title: 'API Three' } }),
      'utf-8'
    );

    const docs = await store.listDocuments();
    expect(docs.length).toBe(3);
    
    // Verify all documents are accessible
    const doc2 = await store.getDocument(doc2Id);
    const doc3 = await store.getDocument(doc3Id);
    
    expect(doc2?.content.info.title).toBe('API Two');
    expect(doc3?.content.info.title).toBe('API Three');
  });

  it('should handle non-JSON files gracefully', async () => {
    // Create a non-JSON file in the directory
    await fs.writeFile(
      path.join(TEST_EXTERNAL_DIR, 'readme.txt'),
      'This is not a document',
      'utf-8'
    );

    // List should only return .json files
    const docs = await store.listDocuments();
    const hasNonJson = docs.some(d => d.filename === 'readme.txt');
    expect(hasNonJson).toBe(false);
  });

  it('should provide correct metadata from filesystem', async () => {
    const doc = await store.getDocument(testDocumentId);
    
    expect(doc?.metadata).toBeDefined();
    expect(doc?.metadata.id).toBe(testDocumentId);
    expect(doc?.metadata.format).toBe('json');
    expect(doc?.metadata.size).toBeGreaterThan(0);
    expect(doc?.metadata.uploadedAt).toBeInstanceOf(Date);
    expect(doc?.metadata.serverCount).toBe(1);
    expect(doc?.metadata.operationCount).toBe(1);
  });
});
