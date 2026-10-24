import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createHash } from 'node:crypto';

export type Row = Record<string, any>;
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}
export interface Database extends Queryable {
  // Callbacks must contain database work only: PostgreSQL may retry a rolled-back
  // serialization failure or deadlock. Never contact a provider inside one.
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function postgresConfig(env:NodeJS.ProcessEnv=process.env) {
  const url=env.DATABASE_URL?new URL(env.DATABASE_URL):undefined;
  if(url&&!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Use a PostgreSQL database URL.');
  // pg connection-string SSL parameters can override the verified CA settings.
  if(url&&[...url.searchParams.keys()].some(key=>key.toLowerCase().startsWith('ssl')))throw new Error('Configure database TLS with DB_CA_FILE and DB_SSL, not URL SSL parameters.');
  const host=url?.hostname||env.DB_HOST;
  if(!host)throw new Error('A PostgreSQL host is required.');
  const local=['localhost','127.0.0.1','[::1]','::1'].includes(host);
  if(env.DB_SSL==='false'&&!local)throw new Error('Unverified hosted database connections are forbidden.');
  if(!local&&!env.DB_CA_FILE)throw new Error('DB_CA_FILE is required for verified hosted PostgreSQL TLS.');
  const ssl=local&&env.DB_SSL!=='true'?false:{rejectUnauthorized:true,...(env.DB_CA_FILE?{ca:readFileSync(env.DB_CA_FILE,'utf8')}:{})};
  return url?{connectionString:env.DATABASE_URL,ssl}:{host,port:Number(env.DB_PORT||5432),database:env.DB_NAME||'relief',user:env.DB_USER||'relief',password:env.DB_PASSWORD,ssl};
}

export async function createDatabase(): Promise<Database> {
  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    const config=postgresConfig();
    const pool = new pg.Pool({ ...config, max: 5,connectionTimeoutMillis:5000,query_timeout:15000,idleTimeoutMillis:30000 });
    return {
      query: (sql, params) => pool.query(sql, params),
      async transaction(fn) {
        for(let attempt=0;attempt<3;attempt++) {
          const client = await pool.connect();
          try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
          catch (error) {
            await client.query('ROLLBACK');
            const code=(error as {code?:string}).code;
            if(attempt===2||!['40001','40P01'].includes(code||''))throw error;
          } finally { client.release(); }
          await new Promise(resolve=>setTimeout(resolve,20+Math.random()*40));
        }
        throw new Error('Database transaction retries exhausted.');
      },
      close: () => pool.end()
    };
  }
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') throw new Error('DATABASE_URL is required outside demo mode');
  return createEmbeddedDatabase(process.env.PGLITE_DIR || '.relief-data');
}

export async function createEmbeddedDatabase(dataDir?:string):Promise<Database> {
  const embedded = dataDir ? new PGlite(dataDir) : new PGlite();
  await embedded.waitReady;
  return {
    query: (sql, params) => embedded.query(sql, params as any[]),
    transaction: (fn) => embedded.transaction((tx) => fn(tx)),
    close: () => embedded.close()
  };
}

const migrations=['001_init.sql','002_job_lease.sql','003_household_timezone.sql','004_atlas_plans.sql','005_in_app_delivery.sql','006_reliability.sql','007_proposals.sql','008_helper_unavailable_dates.sql'];

export async function migrate(db: Database): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migration_lock(id integer PRIMARY KEY)');
  await db.query('INSERT INTO schema_migration_lock(id) VALUES(1) ON CONFLICT DO NOTHING');
  await db.transaction(async tx=>{
    await tx.query('SELECT id FROM schema_migration_lock WHERE id=1 FOR UPDATE');
    for (const name of migrations) {
      const sql=await readFile(new URL(`../sql/${name}`,import.meta.url),'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const prior=(await tx.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name])).rows[0];
      if(prior){if(prior.checksum!==checksum)throw new Error(`Applied migration changed: ${name}. Add a new migration instead.`);continue;}
      for(const statement of sql.split(';').map(part=>part.trim()).filter(Boolean))await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
    }
  });
}

export async function prepareSchema(db:Database):Promise<void> {
  if(process.env.NODE_ENV!=='production'||process.env.DEMO_MODE==='true'){await migrate(db);return;}
  // Runtime credentials only verify the ledger. Deployment runs the bootstrap task first.
  const found=await db.query('SELECT name,checksum FROM schema_migrations');
  if(migrations.some(name=>!found.rows.some(row=>row.name===name)))throw new Error('Database schema is behind this release. Run the administrator bootstrap task first.');
  for(const name of migrations){
    const sql=await readFile(new URL(`../sql/${name}`,import.meta.url),'utf8');
    const checksum=createHash('sha256').update(sql).digest('hex');
    if(found.rows.find(row=>row.name===name)?.checksum!==checksum)throw new Error(`Applied migration changed: ${name}. Verify the release and add a new migration instead.`);
  }
}

export async function seedDemo(db: Database): Promise<void> {
  const users = [
    ['demo-organizer', 'alex@example.test', 'Alex Morgan'],
    ['demo-helper-1', 'sam@example.test', 'Sam Morgan'],
    ['demo-helper-2', 'jordan@example.test', 'Jordan Lee'],
    ['demo-helper-3', 'riley@example.test', 'Riley Chen']
  ];
  for (const [id,email,name] of users) await db.query('INSERT INTO app_users(id,email,display_name) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',[id,email,name]);
  await db.query("INSERT INTO households(id,name,care_recipient_name,consent_attested_at,created_by) VALUES('demo-household','Dad’s circle','Dad',now(),'demo-organizer') ON CONFLICT (id) DO NOTHING");
  for (const [id,userId,email,role] of [
    ['demo-member-organizer','demo-organizer','alex@example.test','organizer'],
    ['demo-member-1','demo-helper-1','sam@example.test','helper'],
    ['demo-member-2','demo-helper-2','jordan@example.test','helper'],
    ['demo-member-3','demo-helper-3','riley@example.test','helper']
  ]) await db.query('INSERT INTO memberships(id,household_id,user_id,email,role,status) VALUES($1,$2,$3,$4,$5,\'active\') ON CONFLICT (id) DO NOTHING',[id,'demo-household',userId,email,role]);
  for (const membershipId of ['demo-member-1','demo-member-2','demo-member-3']) await db.query("INSERT INTO helper_preferences(membership_id,task_types,opted_in,quiet_start,quiet_end) VALUES($1,ARRAY['meal','visit','ride'],true,0,0) ON CONFLICT (membership_id) DO NOTHING",[membershipId]);
}
