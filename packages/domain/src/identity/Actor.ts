export const Role = {
  CREW_LEAD: 'CREW_LEAD',
  PASSENGER: 'PASSENGER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/**
 * The authenticated principal performing an operation. Every application service
 * method that changes or reveals data takes an Actor, so authorization is enforced
 * in the domain itself — not only at the edge.
 */
export interface Actor {
  readonly userId: string;
  readonly role: Role;
}
