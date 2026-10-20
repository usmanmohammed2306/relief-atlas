import { createDatabase,migrate } from './db.js';
import { provisionRuntimeRole } from './db-roles.js';

const db=await createDatabase();
try{
  if(!process.env.APP_DB_USER||!process.env.APP_DB_PASSWORD)throw new Error('Bootstrap requires a separate runtime role and password.');
  await migrate(db);
  await provisionRuntimeRole(db,process.env.APP_DB_USER,process.env.APP_DB_PASSWORD);
  process.stdout.write(JSON.stringify({kind:'database-bootstrap',ok:true})+'\n');
}catch{
  // Do not dump administrator credentials or a SQL password statement into logs.
  process.stderr.write('Database bootstrap failed. Inspect connectivity, schema version, and role configuration without logging credentials.\n');
  process.exitCode=1;
}finally{await db.close();}
