import type { Resource } from './Resource';

export interface ResourceRepository {
  findById(id: string): Promise<Resource | undefined>;
  findAll(): Promise<Resource[]>;
  save(resource: Resource): Promise<void>;
}
