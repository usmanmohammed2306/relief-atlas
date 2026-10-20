import type { Database } from './db.js';

// Only the one-shot administrator task calls this. Neither server nor worker imports it.
export async function provisionRuntimeRole(db:Database,username:string,password:string):Promise<void> {
  if(!/^atlas_[a-z0-9_]{1,40}$/.test(username))throw new Error('Runtime role must have an atlas_ prefix and lowercase identifier characters.');
  if(password.length<24)throw new Error('Runtime database password must be at least 24 characters.');
  const role=`"${username}"`;
  const literal=`'${password.replaceAll("'","''")}'`;
  await db.transaction(async tx=>{
    const exists=(await tx.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[username])).rows.length;
    await tx.query(`${exists?'ALTER':'CREATE'} ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal}`);
    await tx.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await tx.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await tx.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await tx.query(`GRANT SELECT,INSERT,UPDATE ON app_users,households,memberships,helper_preferences,coverage_requests,request_drafts,offers,notifications,jobs,atlas_plans,model_budget,model_calls TO ${role}`);
    await tx.query(`GRANT SELECT,INSERT ON events TO ${role}`);
    await tx.query(`GRANT SELECT ON schema_migrations TO ${role}`);
    // No DELETE, schema CREATE, migration write, or event UPDATE privilege.
  });
}
