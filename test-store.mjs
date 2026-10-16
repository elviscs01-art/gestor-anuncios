export async function createTestStore(pool,flows){
 await pool.query("CREATE TABLE IF NOT EXISTS lab_account (id int PRIMARY KEY CHECK(id=1), status text NOT NULL, user_id text, encrypted text, message text); CREATE TABLE IF NOT EXISTS lab_connection (id int PRIMARY KEY CHECK(id=1), user_id text NOT NULL, encrypted text NOT NULL, expires bigint NOT NULL, scope text NOT NULL, status text NOT NULL); CREATE TABLE IF NOT EXISTS lab_attempts (id text PRIMARY KEY, owner_id text NOT NULL, draft_id text NOT NULL, revision int NOT NULL, test_seller text NOT NULL, snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'prepared', item_id text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(draft_id,revision,test_seller));");
 const lab={
  async account(){const {rows}=await pool.query('SELECT * FROM lab_account WHERE id=1');return rows[0]||null;},
  async claimAccount(){const {rows}=await pool.query("INSERT INTO lab_account(id,status) VALUES(1,'sending') ON CONFLICT(id) DO UPDATE SET status='sending',message=NULL WHERE lab_account.status='rejected' RETURNING id");return !!rows.length;},
  async saveAccount(status,{user_id=null,encrypted=null,message=null}={}){await pool.query('UPDATE lab_account SET status=$1,user_id=$2,encrypted=$3,message=$4 WHERE id=1',[status,user_id,encrypted,message]);},
  async summary(){const {rows}=await pool.query('SELECT user_id,scope,status,expires FROM lab_connection WHERE id=1');return rows[0]||null;},
  async expectedSeller(){const r=await lab.account();return r?.status==='ready'?r.user_id:null;},
  putFlow: (...args)=>flows.putFlow(...args),takeFlow:(...args)=>flows.takeFlow(...args),
  async withConnection(fn){
   const client=await pool.connect();let locked=false;let broken=false;
   try{await client.query('SELECT pg_advisory_lock(74210603)');locked=true;return await fn({
    get:async()=>{const {rows}=await client.query('SELECT * FROM lab_connection WHERE id=1');return rows[0]||null;},
    save:async c=>{await client.query('INSERT INTO lab_connection(id,user_id,encrypted,expires,scope,status) VALUES(1,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,encrypted=excluded.encrypted,expires=excluded.expires,scope=excluded.scope,status=excluded.status',[c.user_id,c.encrypted,c.expires,c.scope,c.status]);}
   });}finally{if(locked){try{await client.query('SELECT pg_advisory_unlock(74210603)');}catch{broken=true;}}client.release(broken||!locked);}
  },
  async createAttempt(row){const {rows}=await pool.query("INSERT INTO lab_attempts(id,owner_id,draft_id,revision,test_seller,snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(draft_id,revision,test_seller) DO UPDATE SET draft_id=excluded.draft_id RETURNING *",[row.id,row.owner_id,row.draft_id,row.revision,row.test_seller,JSON.stringify(row.snapshot)]);return rows[0];},
  async attempt(id,owner){const {rows}=await pool.query('SELECT * FROM lab_attempts WHERE id=$1 AND owner_id=$2',[id,owner]);return rows[0]||null;},
  async attempts(owner){const {rows}=await pool.query('SELECT id,status,item_id,result,created_at FROM lab_attempts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30',[owner]);return rows;},
  async claimAttempt(id,owner){const {rows}=await pool.query("UPDATE lab_attempts SET status='sending' WHERE id=$1 AND owner_id=$2 AND status='prepared' RETURNING *",[id,owner]);return rows[0]||null;},
  async finish(id,owner,status,itemId,result){await pool.query('UPDATE lab_attempts SET status=$3,item_id=$4,result=$5 WHERE id=$1 AND owner_id=$2',[id,owner,status,itemId,JSON.stringify(result)]);}
 };
 return lab;
}
