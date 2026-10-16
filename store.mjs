import {createMetricsStore} from './metrics-store.mjs';
import {createPublicationStore} from './publication-store.mjs';
import {createTestStore} from './test-store.mjs';
// PostgreSQL is the only token store. Temporary sessions are used solely before database setup.
export class SetupSessions {
 constructor(){this.sessions=new Map();this.attempts=[];}
 async ping(){return true;}
 async getSession(id){const s=this.sessions.get(id);return s&&s.expires>Date.now()?s:null;}
 async putSession(id,s){for(const [k,v] of this.sessions)if(v.expires<Date.now())this.sessions.delete(k);if(this.sessions.size>=100)throw new Error('Limite de sessões.');this.sessions.set(id,s);}
 async deleteSession(id){this.sessions.delete(id);}
 async loginAllowed(){const now=Date.now();this.attempts=this.attempts.filter(t=>t>now-60000);if(this.attempts.length>=10)return false;this.attempts.push(now);return true;}
 async summary(){return null;}
}
export async function postgres(url) {
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,query_timeout:20000});
 pool.on('error',()=>console.error('Falha de conexão com o banco; detalhes confidenciais omitidos.'));
 await pool.query(`CREATE TABLE IF NOT EXISTS app_sessions (
 id text PRIMARY KEY, csrf text NOT NULL, stamp text NOT NULL, expires bigint NOT NULL);
 CREATE TABLE IF NOT EXISTS oauth_flows (
 state text PRIMARY KEY, session_id text NOT NULL REFERENCES app_sessions(id) ON DELETE CASCADE,
 verifier text NOT NULL, expires bigint NOT NULL);
 CREATE TABLE IF NOT EXISTS login_limit (id int PRIMARY KEY CHECK(id=1), started timestamptz NOT NULL, attempts int NOT NULL);
 CREATE TABLE IF NOT EXISTS meli_connection (id int PRIMARY KEY CHECK(id=1), user_id text NOT NULL,
 encrypted text NOT NULL, expires bigint NOT NULL, scope text NOT NULL, status text NOT NULL);
 CREATE TABLE IF NOT EXISTS listing_drafts (id text PRIMARY KEY, seller_id text NOT NULL, revision integer NOT NULL DEFAULT 1, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`);
 const store={
  async createDraft(id,seller,data){await pool.query('INSERT INTO listing_drafts(id,seller_id,data) VALUES($1,$2,$3)',[id,seller,JSON.stringify(data)]);},
  async getDraft(id,seller){const {rows}=await pool.query('SELECT id,revision,data,updated_at FROM listing_drafts WHERE id=$1 AND seller_id=$2',[id,seller]);return rows[0]||null;},
  async listDrafts(seller){const {rows}=await pool.query("SELECT id,revision,data->'values'->>'name' AS name,data->>'sourceId' AS source_id,updated_at FROM listing_drafts WHERE seller_id=$1 ORDER BY updated_at DESC LIMIT 50",[seller]);return rows;},
  async updateDraft(id,seller,revision,data){const {rows}=await pool.query('UPDATE listing_drafts SET data=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND seller_id=$2 AND revision=$3 RETURNING id,revision,data,updated_at',[id,seller,revision,JSON.stringify(data)]);return rows[0]||null;},
  async setDraftValidation(id,seller,revision,validation){const {rows}=await pool.query("UPDATE listing_drafts SET data=jsonb_set(data,'{validation}',$4::jsonb),updated_at=now() WHERE id=$1 AND seller_id=$2 AND revision=$3 RETURNING id,revision,data,updated_at",[id,seller,revision,JSON.stringify(validation)]);return rows[0]||null;},
  async ping(){await pool.query('SELECT 1');return true;},
  async getSession(id){const {rows}=await pool.query('SELECT csrf,stamp,expires FROM app_sessions WHERE id=$1 AND expires>$2',[id,Date.now()]);return rows[0]||null;},
  async putSession(id,s){await pool.query('DELETE FROM app_sessions WHERE expires<$1',[Date.now()]);await pool.query('INSERT INTO app_sessions(id,csrf,stamp,expires) VALUES($1,$2,$3,$4)',[id,s.csrf,s.stamp,s.expires]);},
  async deleteSession(id){await pool.query('DELETE FROM app_sessions WHERE id=$1',[id]);},
  async loginAllowed(){const {rows}=await pool.query(`INSERT INTO login_limit(id,started,attempts) VALUES(1,now(),1)
   ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN login_limit.started<now()-interval '1 minute' THEN 1 ELSE login_limit.attempts+1 END,
   started=CASE WHEN login_limit.started<now()-interval '1 minute' THEN now() ELSE login_limit.started END RETURNING attempts`);return rows[0].attempts<=10;},
  async putFlow(state,sessionId,verifier){await pool.query('DELETE FROM oauth_flows WHERE expires<$1 OR session_id=$2',[Date.now(),sessionId]);await pool.query('INSERT INTO oauth_flows(state,session_id,verifier,expires) VALUES($1,$2,$3,$4)',[state,sessionId,verifier,Date.now()+10*60000]);},
  async takeFlow(state,sessionId){const {rows}=await pool.query('DELETE FROM oauth_flows WHERE state=$1 AND session_id=$2 AND expires>$3 RETURNING verifier',[state,sessionId,Date.now()]);return rows[0]?.verifier;},
  async summary(){const {rows}=await pool.query('SELECT user_id,scope,status,expires FROM meli_connection WHERE id=1');return rows[0]||null;},
  async withConnection(fn){
   const client=await pool.connect();let locked=false;let broken=false;
   try {
    await client.query('SELECT pg_advisory_lock(74210602)');locked=true;
    const api={
     async get(){const {rows}=await client.query('SELECT * FROM meli_connection WHERE id=1');return rows[0]||null;},
     async save(c){await client.query(`INSERT INTO meli_connection(id,user_id,encrypted,expires,scope,status) VALUES(1,$1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,encrypted=excluded.encrypted,expires=excluded.expires,scope=excluded.scope,status=excluded.status`,[c.user_id,c.encrypted,c.expires,c.scope,c.status]);}
    };
    return await fn(api);
   } finally {
    if(locked){try{await client.query('SELECT pg_advisory_unlock(74210602)');}catch{broken=true;}}
    // If a lock request timed out, discard the connection to release any lock acquired late.
    client.release(broken||!locked);
   }
  },
  async close(){await pool.end();}
 };
 store.testing=await createTestStore(pool,store);
 store.publications=await createPublicationStore(pool);
 store.metrics=await createMetricsStore(pool);
 store.dashboard=await createMetricsStore(pool,'dashboard_jobs');
 store.catalog=await createMetricsStore(pool,'catalog_jobs');
 return store;
}
