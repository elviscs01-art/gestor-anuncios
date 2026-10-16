import {UserError,random} from './security.mjs';
export function createPublications({store,meli}){
 const db=store.publications;
 const message=e=>e instanceof UserError?e.message:'Não foi possível confirmar esta etapa. Confira o anúncio antes de repetir.';
 return {
  async list(owner){return db.attempts(owner);},
  async result(id,owner){const r=await db.attempt(id,owner);if(!r)throw new UserError('Publicação não encontrada.',404);return r;},
  async prepare(owner,id,revision){
   const draft=await store.getDraft(id,owner);
   if(!draft)throw new UserError('Rascunho não encontrado.',404);
   if(draft.revision!==revision)throw new UserError('O rascunho mudou. Reabra a versão salva.',409);
   const snapshot=await meli.prepareOfficial(draft.data,owner);
   return db.createAttempt({id:random(),owner_id:owner,draft_id:id,revision,test_seller:owner,snapshot});
  },
  async run(id,owner){
   const current=await this.result(id,owner);
   if(current.status!=='prepared')return current;
   const draft=await store.getDraft(current.draft_id,owner);
   if(!draft||draft.revision!==current.revision)throw new UserError('O rascunho mudou após a revisão. Prepare uma nova prévia.',409);
   const row=await db.claimAttempt(id,owner);if(!row)return this.result(id,owner);
   let item;
   try{item=await meli.createOfficialListing(row.snapshot,owner);}
   catch(e){await db.finish(id,owner,e instanceof UserError&&!e.uncertain?'rejected':'unknown',null,{message:message(e)});return this.result(id,owner);}
   let result={itemStatus:item.status,description:'pending',message:'Anúncio criado na conta oficial. Solicitando pausa.'};
   await db.finish(id,owner,'created',item.id,result);
   // Pause before description to reduce exposure; never retry the creation.
   try{result.itemStatus=await meli.pauseOfficialListing(item.id,owner);}catch(e){result.pauseMessage=message(e);}
   await db.finish(id,owner,'created',item.id,result);
   try{await meli.describeOfficialListing(item.id,owner,row.snapshot.description);result.description=row.snapshot.description.trim()?'saved':'empty';}catch(e){result.description='unconfirmed';result.descriptionMessage=message(e);}
   result.message='Criação realizada na conta oficial. Confira o status e as etapas abaixo.';
   await db.finish(id,owner,['saved','empty'].includes(result.description)&&result.itemStatus==='paused'?'completed':'partial',item.id,result);
   return this.result(id,owner);
  },
  async pause(id,owner){
   const row=await this.result(id,owner);if(!row.item_id)throw new UserError('Não há anúncio identificado para pausar.',409);
   const status=await meli.pauseOfficialListing(row.item_id,owner);
   await db.finish(id,owner,['saved','empty'].includes(row.result?.description)&&status==='paused'?'completed':'partial',row.item_id,{...row.result,itemStatus:status,pauseMessage:''});
   return this.result(id,owner);
  }
 };
}
