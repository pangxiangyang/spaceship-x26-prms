import type { Resource } from '../../resources/Resource';
import type { ResourceRepository } from '../../resources/ResourceRepository';

export class InMemoryResourceRepository implements ResourceRepository {
  private readonly byId = new Map<string, Resource>();

  /** Removes everything. Used by the demo reset. */
  clear(): void {
    this.byId.clear();
  }

  async findById(id: string): Promise<Resource | undefined> {
    return this.byId.get(id);
  }

  async findAll(): Promise<Resource[]> {
    return [...this.byId.values()];
  }

  async save(resource: Resource): Promise<void> {
    this.byId.set(resource.id, resource);
  }
}
