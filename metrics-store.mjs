import {random} from './security.mjs';
export async function createMetricsStore(pool){
 await pool.query("CREATE TABLE IF NOT EXISTS metrics_jobs (owner_id text PRIMARY KEY, status text NOT NULL, data jsonb NOT NULL, snapshot jsonb, message text, token text, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now());");
 return {
  async read(owner){const {rows}=await pool.query('SELECT status,data,snapshot,message,updated_at FROM metrics_jobs WHERE owner_id=$1',[owner]);return rows[0]||null;},
  async start(owner,data){await pool.query("INSERT INTO metrics_jobs(owner_id,status,data) VALUES($1,'running',$2) ON CONFLICT(owner_id) DO UPDATE SET status='running',data=excluded.data,message=NULL,token=NULL,lease_until=NULL,updated_at=now() WHERE metrics_jobs.status NOT IN ('running','paused')",[owner,JSON.stringify(data)]);},
  async claim(owner){const token=random();const {rows}=await pool.query("UPDATE metrics_jobs SET token=$2,lease_until=now()+interval '120 seconds' WHERE owner_id=$1 AND status='running' AND (lease_until IS NULL OR lease_until<now()) RETURNING data",[owner,token]);return rows[0]?{data:rows[0].data,token}:null;},
  async save(owner,token,data,status,message=null){await pool.query("UPDATE metrics_jobs SET data=$3,status=$4,message=$5,snapshot=CASE WHEN $4='complete' THEN $3::jsonb ELSE snapshot END,token=NULL,lease_until=NULL,updated_at=now() WHERE owner_id=$1 AND token=$2 AND status='running'",[owner,token,JSON.stringify(data),status,message]);},
  async pause(owner){await pool.query("UPDATE metrics_jobs SET status='paused',token=NULL,lease_until=NULL WHERE owner_id=$1 AND status='running'",[owner]);},
  async resume(owner){await pool.query("UPDATE metrics_jobs SET status='running' WHERE owner_id=$1 AND status='paused'",[owner]);},
  async discard(owner){await pool.query("UPDATE metrics_jobs SET status='failed',token=NULL,lease_until=NULL,message='Coleta interrompida pelo usuário.' WHERE owner_id=$1",[owner]);}
 };
}
