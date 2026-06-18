/**
 * @cisco-open/linting-document-store
 * 
 * Pluggable document storage library for API specifications
 * 
 * Main exports:
 * - Interfaces: DocumentStoreAdapter, types
 * - Adapters: LocalDocumentStore, PassThroughDocumentStore
 * - Core: DocumentCoordinator, DatastoreManager, DocumentCache (for advanced use)
 * - Utils: Logger, validation functions
 */

// Export interfaces and types
export * from './interfaces/index.js';

// Export adapters
export { LocalDocumentStore } from './adapters/local-document-store.js';
export { PassThroughDocumentStore } from './adapters/pass-through-document-store.js';

// Export core components (for advanced users)
export { DocumentCoordinator } from './core/document-coordinator.js';
export { DatastoreManager } from './core/datastore-manager.js';
export { DocumentCache } from './core/document-cache.js';

// Export utilities
export { getLogger, initializeLogger, setGlobalLogLevel, LogLevel } from './utils/logger.js';
export { isValidDocumentId, sanitizeFilename, isValidOpenAPIDocument } from './utils/validation.js';
