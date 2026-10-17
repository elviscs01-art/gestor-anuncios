import {random} from './security.mjs';
export async function createReplacementStore(pool){
 await pool.query("CREATE TABLE IF NOT EXISTS replacement_jobs(id text PRIMARY KEY,owner_id text NOT NULL,source_id text NOT NULL,data jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',token text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,source_id))");
 return {
  async read(id,owner){const {rows}=await pool.query('SELECT * FROM replacement_jobs WHERE id=$1 AND owner_id=$2',[id,owner]);return rows[0]||null;},
  async find(owner,source){const {rows}=await pool.query('SELECT * FROM replacement_jobs WHERE owner_id=$1 AND source_id=$2',[owner,source]);return rows[0]||null;},
  async list(owner){const {rows}=await pool.query('SELECT id,source_id,status,created_at FROM replacement_jobs WHERE owner_id=$1 ORDER BY created_at DESC',[owner]);return rows;},
  async create(id,owner,source,data){await pool.query('INSERT INTO replacement_jobs(id,owner_id,source_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,source_id) DO NOTHING',[id,owner,source,JSON.stringify(data)]);return this.find(owner,source);},
  async claim(id,owner){const token=random();const {rows}=await pool.query("UPDATE replacement_jobs SET token=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='queued' AND token IS NULL RETURNING data",[id,owner,token]);return rows[0]?{data:rows[0].data,token}:null;},
  async checkpoint(id,owner,token,data){await pool.query('UPDATE replacement_jobs SET data=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 AND token=$3',[id,owner,token,JSON.stringify(data)]);},
  async finish(id,owner,token,data,status){await pool.query('UPDATE replacement_jobs SET data=$4,status=$5,token=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND token=$3',[id,owner,token,JSON.stringify(data),status]);}
 };
}
