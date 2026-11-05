export const ResourceCategory = {
  SLEEPING_POD: 'SLEEPING_POD',
  FOOD_STATION: 'FOOD_STATION',
  OXYGEN: 'OXYGEN',
  MEDICAL: 'MEDICAL',
  HYGIENE: 'HYGIENE',
  FITNESS: 'FITNESS',
  CABIN: 'CABIN',
  RECREATION: 'RECREATION',
} as const;

export type ResourceCategory = (typeof ResourceCategory)[keyof typeof ResourceCategory];

export const ALL_RESOURCE_CATEGORIES: readonly ResourceCategory[] = Object.freeze(
  Object.values(ResourceCategory),
);

export function isResourceCategory(value: unknown): value is ResourceCategory {
  return typeof value === 'string' && (ALL_RESOURCE_CATEGORIES as string[]).includes(value);
}
