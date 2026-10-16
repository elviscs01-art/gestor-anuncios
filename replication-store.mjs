import {random} from './security.mjs';
export async function createReplicationStore(pool){
 await pool.query("CREATE TABLE IF NOT EXISTS replication_batches(id text PRIMARY KEY,owner_id text NOT NULL,data jsonb NOT NULL,status text NOT NULL DEFAULT 'editing',token text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())");
 return {
  async create(id,owner,data){await pool.query('INSERT INTO replication_batches(id,owner_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,owner,JSON.stringify(data)]);return this.read(id,owner);},
  async read(id,owner){const {rows}=await pool.query('SELECT * FROM replication_batches WHERE id=$1 AND owner_id=$2',[id,owner]);return rows[0]||null;},
  async list(owner){const {rows}=await pool.query("SELECT id,status,data->'source'->>'sourceTitle' AS title,created_at FROM replication_batches WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",[owner]);return rows;},
  async submit(id,owner,data){await pool.query("UPDATE replication_batches SET data=$3,status='queued',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='editing'",[id,owner,JSON.stringify(data)]);},
  async claim(id,owner){const token=random();const {rows}=await pool.query("UPDATE replication_batches SET token=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='queued' AND token IS NULL RETURNING data",[id,owner,token]);return rows[0]?{data:rows[0].data,token}:null;},
  async checkpoint(id,owner,token,data){await pool.query('UPDATE replication_batches SET data=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 AND token=$3',[id,owner,token,JSON.stringify(data)]);},
  async finish(id,owner,token,data,status){await pool.query('UPDATE replication_batches SET data=$4,status=$5,token=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND token=$3',[id,owner,token,JSON.stringify(data),status]);}
 };
}
