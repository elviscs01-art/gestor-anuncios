import {diagnosticDiff,recordFailure,errorInfo} from './diagnostics.mjs';
import {UserError,random} from './security.mjs';
import {applyPackaging,readPackaging} from './replication-fields.mjs';
export function sameSource(a,b){
 const stable=v=>Array.isArray(v)?v.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 const select=s=>({sourceId:s.sourceId,sourceTitle:s.sourceTitle,sourceFamily:s.sourceFamily,description:s.description,payload:s.payload,compatibilities:s.compatibilities});
 return JSON.stringify(stable(select(a)))===JSON.stringify(stable(select(b)));
}
export function replacementSnapshot(source){
 const result=applyPackaging(source,source.packaging||readPackaging(source.payload));
 if(Object.keys(result.errors).length){const error=new UserError('O anúncio-base não informa todas as medidas da embalagem. Como a substituição não permite edição, complete esses dados no anúncio original antes de tentar novamente. Nada foi excluído.',409);error.diagnosticDetails={sourceId:source.sourceId,validation:'package',sourceEvidence:source.packagingEvidence,values:source.packaging||readPackaging(source.payload),units:{height:'cm',width:'cm',length:'cm',weight:'g'},invalidFields:Object.keys(result.errors),reasons:result.errors};throw error;}
 const s=result.source;s.payload[s.mode]=s.mode==='family_name'?s.sourceFamily:s.sourceTitle;
 if(!s.payload[s.mode])throw new UserError('O nome original não pôde ser confirmado. Nada foi excluído.',409);
 s.expectedDisplayTitle=s.sourceTitle;
 return s;
}
export function selectReplacementRows(rows,search=''){
 const q=search.trim().toLowerCase();return rows.filter(r=>r.sold===0&&!r.error&&(!q||[r.id,...r.skus||[]].some(v=>String(v).toLowerCase().includes(q)))).sort((a,b)=>(Date.parse(a.created)||Infinity)-(Date.parse(b.created)||Infinity)||a.id.localeCompare(b.id));
}
export function createReplacement({db,meli}){
 const msg=e=>e instanceof UserError?e.message:'Não foi possível confirmar esta etapa. Confira os anúncios antes de repetir.';
 return {
  list:owner=>db.list(owner),
  async read(id,owner){const row=await db.read(id,owner);if(!row)throw new UserError('Substituição não encontrada.',404);return row;},
  async begin(owner,item){
   if(!/^MLB\d{6,20}$/.test(String(item)))throw new UserError('Código de anúncio inválido.');
   const existing=await db.find(owner,item);if(existing)return existing;
   const source=await meli.replacementSource(item,owner),snapshot=replacementSnapshot(source);
   return db.create(random(),owner,item,{source,snapshot,stage:'validate',oldStatus:source.originalStatus,newStatus:null,message:'Substituição preparada. O original só será excluído depois da conferência da cópia.'});
  },
  async retry(id,owner){
   const row=await this.read(id,owner);if(row.status!=='blocked')return row;
   const claim=await db.claimRetry(id,owner);if(!claim)return this.read(id,owner);let d=claim.data,status='queued';
   try{
    if(!d.newId){
     if(d.creationStarted&&!d.creationRejected)throw new UserError('A criação anterior não teve resposta conclusiva. Confira a conta; uma nova cópia não será criada automaticamente.',409);
     const source=await meli.replacementSource(d.source.sourceId,owner);d={audit:d.audit||[],source,snapshot:replacementSnapshot(source),stage:'validate',oldStatus:source.originalStatus,newStatus:null};
    }else{Object.assign(d,await meli.recoverReplacement(d,owner));if(d.stage==='done')status='complete';}
    delete d.error;d.message=status==='complete'?'Exclusão do original confirmada. Substituição concluída.':'Tentativa retomada após conferir os anúncios existentes.';
   }catch(e){await recordFailure('replacement.retry:'+id,{operation:'replacement.retry',jobId:id,sourceId:d.source?.sourceId,newId:d.newId,stage:d.stage,...errorInfo(e)});status='blocked';d.error=msg(e);}
   d.audit=[...(d.audit||[]),{stage:d.stage,event:status==='blocked'?'retry_failed':'retry_reconciled',at:new Date().toISOString(),oldStatus:d.oldStatus,newStatus:d.newStatus,newId:d.newId||null}].slice(-30);
   await db.finish(id,owner,claim.token,d,status);return this.read(id,owner);
  },
  async advance(id,owner){const claim=await db.claim(id,owner);if(!claim)return this.read(id,owner);const d=claim.data;let status='queued';const diagnosticStage=d.stage;d.audit=[...(d.audit||[]),{stage:diagnosticStage,event:'started',at:new Date().toISOString(),newId:d.newId||null}].slice(-30);
   try{
    switch(d.stage){
     case 'validate':{const result=await meli.validateReplication(d.snapshot,owner);d.warnings=result.warnings||[];if(!result.ok)throw new UserError(result.message,409);d.stage='create';d.message='Dados validados. Preparando a nova publicação.';break;}
     case 'create':{
      const current=await meli.replacementSource(d.source.sourceId,owner);if(!sameSource(current,d.source)||current.originalStatus!==d.source.originalStatus){const error=new UserError('O anúncio original mudou desde a preparação. Nenhum anúncio novo foi criado e nada foi excluído.',409);error.diagnosticDetails=diagnosticDiff(d.source,current);throw error;}
      d.creationStarted=true;await db.checkpoint(id,owner,claim.token,d);
      const item=await meli.createOfficialListing(d.snapshot,owner);d.newId=item.id;d.newStatus=item.status;d.stage='pause_new';d.message='Novo anúncio criado. Completando os dados antes de remover o original.';break;}
     case 'pause_new':d.newStatus='não confirmado';await db.checkpoint(id,owner,claim.token,d);d.newStatus=await meli.pauseOfficialListing(d.newId,owner);if(d.newStatus!=='paused')throw new UserError('A nova publicação não confirmou a pausa. O original foi preservado.',409);d.stage='description';break;
     case 'description':await meli.describeOfficialListing(d.newId,owner,d.snapshot.description);d.stage='compatibilities';break;
     case 'compatibilities':await meli.applyReplicationCompatibilities(d.newId,owner,(d.remainingCompat??d.snapshot.compatibilities));delete d.remainingCompat;d.stage='verify';break;
     case 'verify':await meli.verifyReplication(d.newId,owner,d.snapshot);d.stage=d.source.originalStatus==='active'?'activate_new':'pause_old';d.message='Cópia conferida. Preparando a substituição do original.';break;
     case 'activate_new':d.newStatus='não confirmado';await db.checkpoint(id,owner,claim.token,d);d.newStatus=await meli.activateReplication(d.newId,owner);d.stage='pause_old';break;
     case 'pause_old':{
      await meli.checkReplacementPair(d.source,d.snapshot,d.newId,owner,false);
      d.oldStatus='não confirmado';await db.checkpoint(id,owner,claim.token,d);
      d.oldStatus=await meli.pauseOfficialListing(d.source.sourceId,owner);if(d.oldStatus!=='paused')throw new UserError('O original não confirmou a pausa. A exclusão não foi enviada.',409);d.stage='close_old';break;}
     case 'close_old':{
      await meli.checkReplacementPair(d.source,d.snapshot,d.newId,owner,true);
      d.oldStatus='não confirmado';await db.checkpoint(id,owner,claim.token,d);
      d.oldStatus=await meli.closeReplacementOriginal(d.source.sourceId,d.newId,owner);d.stage='delete_old';d.message='Novo anúncio conferido e original encerrado. Concluindo a exclusão.';break;}
     case 'delete_old':{
      d.oldStatus='exclusão não confirmada';await db.checkpoint(id,owner,claim.token,d);
      await meli.deleteReplacementOriginal(d.source,d.snapshot,d.newId,owner);d.oldStatus='deleted';d.stage='done';d.message='Substituição concluída: novo anúncio conferido e original excluído.';status='complete';break;}
     default:throw new UserError('Etapa desconhecida. Confira o resultado antes de repetir.',409);
    }
   }catch(e){await recordFailure('replacement.advance:'+id,{operation:'replacement.advance',jobId:id,sourceId:d.source?.sourceId,newId:d.newId,stage:diagnosticStage,...errorInfo(e)});if(d.stage==='create'&&d.creationStarted&&!d.newId&&e instanceof UserError&&e.uncertain===false)d.creationRejected=true;status='blocked';d.error=msg(e);d.message=d.newId?'A substituição foi interrompida. Confira abaixo os dois anúncios; não crie outra cópia.':'A substituição foi interrompida. O anúncio original não foi excluído.';if(d.creationStarted&&!d.newId)d.message='O resultado da criação precisa ser conferido. Não repita: pode existir um novo anúncio sem confirmação.';}
   d.audit=[...(d.audit||[]),{stage:diagnosticStage,event:status==='blocked'?'failed':'confirmed',at:new Date().toISOString(),oldStatus:d.oldStatus,newStatus:d.newStatus,newId:d.newId||null}].slice(-30);
   await db.finish(id,owner,claim.token,d,status);return this.read(id,owner);
  }
 };
}
