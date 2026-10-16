import {UserError,random} from './security.mjs';
export function createLab({store,live,test,crypto}){
 const db=store.testing;
 const message=error=>error instanceof UserError?error.message:'Não foi possível concluir. Confira o resultado antes de repetir.';
 return {
  async home(owner){const account=await db.account();return {account:account?{status:account.status,message:account.message,user_id:account.user_id,...account.status==='ready'?{credentials:crypto.open(account.encrypted,'test-account')}:{}}:null,connection:await db.summary(),attempts:await db.attempts(owner)};},
  async createAccount(){
   if(!await db.claimAccount())return;
   try{const account=await live.createTestUser();await db.saveAccount('ready',{user_id:account.id,encrypted:crypto.seal(account,'test-account')});}
   catch(error){await db.saveAccount(error instanceof UserError&&!error.uncertain?'rejected':'unknown',{message:message(error)});}
  },
  async prepare(owner,draftId,revision){
   const draft=await store.getDraft(draftId,owner);
   if(!draft)throw new UserError('Rascunho não encontrado.',404);
   if(draft.revision!==revision)throw new UserError('O rascunho mudou. Reabra a versão salva antes de preparar o teste.',409);
   const account=await db.account();if(account?.status!=='ready')throw new UserError('Crie e conecte a conta de teste primeiro.',409);
   const snapshot=await test.prepareTest(draft.data,account.user_id);const id=random();
   snapshot.payload.attributes=snapshot.payload.attributes.filter(a=>a.id!=='SELLER_SKU');snapshot.payload.attributes.push({id:'SELLER_SKU',value_name:'TESTE-'+id.slice(0,24)});
   return db.createAttempt({id,owner_id:owner,draft_id:draftId,revision,test_seller:account.user_id,snapshot});
  },
  async result(id,owner){const row=await db.attempt(id,owner);if(!row)throw new UserError('Teste não encontrado.',404);return row;},
  async run(id,owner){
   const row=await db.claimAttempt(id,owner);if(!row)return this.result(id,owner);
   let item;
   try{item=await test.createTestListing(row.snapshot,row.test_seller);}
   catch(error){await db.finish(id,owner,error instanceof UserError&&!error.uncertain?'rejected':'unknown',null,{message:message(error)});return this.result(id,owner);}
   // Save the new ID before any follow-up request. A retry cannot create the item again.
   await db.finish(id,owner,'created',item.id,{itemStatus:item.status,description:'pending',message:'Anúncio criado na conta de teste. Finalizando descrição e pausa.'});
   let description='saved',descriptionMessage='';
   try{await test.describeTestListing(item.id,row.test_seller,row.snapshot.description);}
   catch(error){description='unconfirmed';descriptionMessage=message(error);}
   await db.finish(id,owner,'created',item.id,{itemStatus:item.status,description,descriptionMessage,message:'Anúncio de teste criado. Conferindo pausa.'});
   let itemStatus=item.status,pauseMessage='';
   try{itemStatus=await test.pauseTestListing(item.id,row.test_seller);}
   catch(error){pauseMessage=message(error);}
   await db.finish(id,owner,description==='saved'&&itemStatus==='paused'?'completed':'partial',item.id,{itemStatus,description,descriptionMessage,pauseMessage,message:'Criação realizada na conta de teste. Consulte os resultados abaixo.'});
   return this.result(id,owner);
  },
  async pause(id,owner){
   const row=await this.result(id,owner);if(!row.item_id)throw new UserError('Nenhum anúncio identificado para pausar.',409);
   const status=await test.pauseTestListing(row.item_id,row.test_seller);
   await db.finish(id,owner,row.result?.description==='saved'&&status==='paused'?'completed':'partial',row.item_id,{...row.result,itemStatus:status,pauseMessage:''});
   return this.result(id,owner);
  }
 };
}
