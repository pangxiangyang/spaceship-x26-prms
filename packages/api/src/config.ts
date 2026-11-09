import { z } from 'zod';

export interface CrewLeadSeed {
  username: string;
  displayName: string;
  password: string;
}

export type StorageConfig =
  | { kind: 'memory' }
  | {
      kind: 'firestore';
      /** Omit on Google Cloud: detected from the runtime or ADC. */
      projectId?: string;
      databaseId: string;
      /** Namespaces every collection, e.g. `staging_`. */
      collectionPrefix: string;
    };

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  jwtSecret: string;
  tokenTtlSeconds: number;
  bcryptCost: number;
  /**
   * Demo mode: seeds passengers, resources and a week of history when storage
   * is empty, and publishes the demo sign-in details on the login page.
   */
  seedDemoData: boolean;
  crewLeads: CrewLeadSeed[];
  /** Directory containing the built web client, served at `/` when present. */
  webDistDir: string | undefined;
  loginRateLimit: { windowMs: number; max: number };
  storage: StorageConfig;
  /** Reverse proxies in front of the app (Cloud Run: 1). 0 trusts none. */
  trustProxy: number;
}

/** Demo credentials. Never used when NODE_ENV=production. */
export const DEMO_CREW_LEADS: CrewLeadSeed[] = [
  { username: 'commander', displayName: 'Cmdr. Ava Reyes', password: 'crewlead123' },
  { username: 'navigator', displayName: 'Lt. Kenji Sato', password: 'crewlead123' },
  { username: 'medic', displayName: 'Dr. Leila Haddad', password: 'crewlead123' },
];

const DEV_JWT_SECRET = 'dev-only-secret-change-me-before-launching-to-mars';

const crewLeadsSchema = z
  .array(
    z.object({
      username: z.string().min(3),
      displayName: z.string().min(1),
      password: z.string().min(12, 'Crew Lead passwords must be at least 12 characters'),
    }),
  )
  .length(3, 'PRMS_CREW_LEADS must define exactly three Crew Leads');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 60 * 60),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  SEED_DEMO_DATA: z.enum(['true', 'false']).optional(),
  PRMS_CREW_LEADS: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  STORAGE: z.enum(['memory', 'firestore']).optional(),
  FIRESTORE_PROJECT_ID: z.string().min(1).optional(),
  FIRESTORE_DATABASE_ID: z.string().min(1).default('(default)'),
  FIRESTORE_COLLECTION_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]*$/, 'may contain only letters, digits, "_" and "-"')
    .default(''),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
});

export class ConfigError extends Error {}

/**
 * Reads configuration from the environment and fails fast on anything unsafe.
 * Development has convenient defaults; production must state its own secrets
 * and storage explicitly.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  if (production && !e.JWT_SECRET) {
    throw new ConfigError('JWT_SECRET is required in production.');
  }

  let crewLeads = DEMO_CREW_LEADS;
  if (e.PRMS_CREW_LEADS) {
    let raw: unknown;
    try {
      raw = JSON.parse(e.PRMS_CREW_LEADS);
    } catch {
      throw new ConfigError('PRMS_CREW_LEADS must be valid JSON.');
    }
    const result = crewLeadsSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(`Invalid PRMS_CREW_LEADS: ${result.error.issues[0]?.message}`);
    }
    crewLeads = result.data;
  } else if (production) {
    throw new ConfigError('PRMS_CREW_LEADS is required in production.');
  }

  // In-memory storage loses everything on restart, so production must opt in explicitly.
  if (production && !e.STORAGE) {
    throw new ConfigError('STORAGE is required in production (memory or firestore).');
  }
  const storage: StorageConfig =
    e.STORAGE === 'firestore'
      ? {
          kind: 'firestore',
          ...(e.FIRESTORE_PROJECT_ID ? { projectId: e.FIRESTORE_PROJECT_ID } : {}),
          databaseId: e.FIRESTORE_DATABASE_ID,
          collectionPrefix: e.FIRESTORE_COLLECTION_PREFIX,
        }
      : { kind: 'memory' };

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
    tokenTtlSeconds: e.TOKEN_TTL_SECONDS,
    bcryptCost: e.BCRYPT_COST,
    seedDemoData: e.SEED_DEMO_DATA ? e.SEED_DEMO_DATA === 'true' : !production,
    crewLeads,
    webDistDir: e.WEB_DIST_DIR,
    loginRateLimit: { windowMs: 15 * 60 * 1000, max: e.LOGIN_RATE_LIMIT_MAX },
    storage,
    trustProxy: e.TRUST_PROXY,
  };
}
