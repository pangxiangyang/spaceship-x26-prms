import { createMemoryPersistence } from '../../src/persistence/memoryPersistence';
import { describePersistenceContract } from './persistenceContract';

describePersistenceContract('in-memory', () => createMemoryPersistence());
