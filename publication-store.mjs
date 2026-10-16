export async function createPublicationStore(pool){
 await pool.query("CREATE TABLE IF NOT EXISTS official_attempts (id text PRIMARY KEY, owner_id text NOT NULL, draft_id text NOT NULL, revision int NOT NULL, test_seller text NOT NULL, snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'prepared', item_id text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(draft_id,revision,test_seller));");
 return {
  async createAttempt(row){const {rows}=await pool.query("INSERT INTO official_attempts(id,owner_id,draft_id,revision,test_seller,snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(draft_id,revision,test_seller) DO UPDATE SET draft_id=excluded.draft_id RETURNING *",[row.id,row.owner_id,row.draft_id,row.revision,row.test_seller,JSON.stringify(row.snapshot)]);return rows[0];},
  async attempt(id,owner){const {rows}=await pool.query('SELECT * FROM official_attempts WHERE id=$1 AND owner_id=$2',[id,owner]);return rows[0]||null;},
  async attempts(owner){const {rows}=await pool.query('SELECT id,status,item_id,result,created_at FROM official_attempts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30',[owner]);return rows;},
  async claimAttempt(id,owner){const {rows}=await pool.query("UPDATE official_attempts SET status='sending' WHERE id=$1 AND owner_id=$2 AND status='prepared' RETURNING *",[id,owner]);return rows[0]||null;},
  async finish(id,owner,status,itemId,result){await pool.query('UPDATE official_attempts SET status=$3,item_id=$4,result=$5 WHERE id=$1 AND owner_id=$2',[id,owner,status,itemId,JSON.stringify(result)]);}
 };
}
