import {errorInfo,recordFailure} from './diagnostics.mjs';
import {priceValue,titleLimit,readPackaging,applyPackaging,packageId,packageFields} from './replication-fields.mjs';
import {UserError,random} from './security.mjs';
export const normalizeTitle=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
const value=a=>{const r={id:a.id};for(const k of ['value_id','value_name','value_struct','values'])if(a[k]!=null)r[k]=structuredClone(a[k]);return r;};
export function compatibilityPlan(data){
 if(!data||(!Array.isArray(data.products)&&!data.universal))throw new UserError('Não foi possível confirmar as compatibilidades do anúncio-base.',409);
 if(data.paging?.total>data.products?.length)throw new UserError('A consulta retornou compatibilidades incompletas. A cópia foi bloqueada para não perder veículos.',409);
 if(data.universal||Number(data.catalog_compatibilities_count)>0||(data.products||[]).some(p=>p.source==='CATALOGO'||!p.catalog_product_id))throw new UserError('Este anúncio tem compatibilidades universais ou de catálogo que não podem ser copiadas integralmente pela API. A replicação foi bloqueada para não perder os veículos compatíveis.',409);
 return (data.products||[]).map(p=>{if(!/^MLB[0-9]+$/.test(p.catalog_product_id)||!p.domain_id)throw new UserError('Compatibilidade incompleta no anúncio-base.',409);return {id:p.catalog_product_id,domain:p.domain_id,...typeof p.note==='string'?{note:p.note}:{},...Array.isArray(p.restrictions)?{restrictions:structuredClone(p.restrictions)}:{}};});
}
export function replicationSource({item,profile,category,schema,description,compatibility}){
 if(String(item.seller_id)!==String(profile.id))throw new UserError('O anúncio pertence a outra conta.',403);
 if(item.catalog_listing)throw new UserError('Este anúncio é de catálogo e não permite replicação com títulos independentes neste fluxo.',409);
 if(item.variations?.length)throw new UserError('Este anúncio possui variações. A replicação em lote desta versão aceita anúncios sem variações, para preservar os dados sem alterações.',409);
 if(!Number.isSafeInteger(item.available_quantity)||item.available_quantity<1)throw new UserError('O anúncio-base precisa ter quantidade disponível maior que zero para replicar sem alterar o estoque informado.',409);
 if(!category||category.id!==item.category_id||!Array.isArray(schema)||typeof description?.plain_text!=='string')throw new UserError('Dados do anúncio-base incompletos. Nenhuma cópia foi criada.',502);
 const readonly=new Set(schema.filter(a=>a.tags?.read_only||a.tags?.inferred).map(a=>a.id));
 const payload={category_id:item.category_id,currency_id:item.currency_id,price:item.price,available_quantity:item.available_quantity,buying_mode:item.buying_mode||'buy_it_now',condition:item.condition,listing_type_id:item.listing_type_id,pictures:(item.pictures||[]).map(p=>({id:p.id})),attributes:(item.attributes||[]).filter(a=>(!readonly.has(a.id)||packageFields.some(([k])=>packageId(k)===a.id))).map(value)};
 if(!payload.pictures.length||payload.currency_id!=='BRL'||!(payload.price>0))throw new UserError('Preço, moeda ou fotos indisponíveis no anúncio-base.',409);
 if(item.seller_custom_field!=null)payload.seller_custom_field=item.seller_custom_field;
 if(item.official_store_id!=null)payload.official_store_id=item.official_store_id;
 if(item.sale_terms?.length)payload.sale_terms=item.sale_terms.map(value);
 if(item.shipping){payload.shipping={};for(const k of ['mode','free_shipping','local_pick_up','dimensions','free_methods','methods'])if(item.shipping[k]!=null)payload.shipping[k]=structuredClone(item.shipping[k]);}
 const mode=profile.tags?.includes('user_product_seller')?'family_name':'title';
 return {kind:'official',sellerId:String(profile.id),sellerName:String(profile.nickname||profile.id),sourceId:item.id,sourceTitle:String(item.title||item.family_name||''),sourceFamily:item.family_name||'',mode,maxTitle:Math.min(60,category.settings?.max_title_length||60),packaging:readPackaging(item),packagingEvidence:{shippingDimensions:item.shipping?.dimensions??null,sellerAttributes:(item.attributes||[]).filter(a=>packageFields.some(([k])=>a.id===packageId(k))).map(value)},payload,description:description.plain_text,compatibilities:compatibilityPlan(compatibility),capturedAt:new Date().toISOString()};
}
export function validateCopies(source,copies){
 const errors={};if(!Array.isArray(copies)||copies.length<1||copies.length>20)throw new UserError('Escolha entre 1 e 20 anúncios por lote.');
 const seen=new Map();copies.forEach((c,i)=>{const title=normalizeTitle(c.title);if(!title||title===normalizeTitle(source.sourceTitle)||title===normalizeTitle(source.sourceFamily))errors[i]='Altere o título: ele ainda está igual ao anúncio-base.';else if(String(c.title).trim().length>titleLimit(source))errors[i]='O título ultrapassa '+titleLimit(source)+' caracteres.';else if(seen.has(title)){errors[i]='Use um título diferente dos demais anúncios deste lote.';errors[seen.get(title)]='Use um título diferente dos demais anúncios deste lote.';}else seen.set(title,i);if(priceValue(c.price??source.payload.price)===null)errors['price'+i]='Informe um preço maior que zero, com até duas casas decimais.';if(!['gold_special','gold_pro'].includes(c.type))errors[i]='Escolha Clássico ou Premium.';});return errors;
}
export function copySnapshot(source,copy){const snapshot=structuredClone(source);snapshot.payload[snapshot.mode]=copy.title.trim();if(snapshot.mode==='family_name'&&copy.acceptedFamily)snapshot.payload.family_name=copy.acceptedFamily;snapshot.payload.listing_type_id=copy.type;snapshot.payload.price=priceValue(copy.price??source.payload.price);return snapshot;}
export function createReplication({db,meli}){
 const message=e=>e instanceof UserError?e.message:'Não foi possível confirmar a operação. Confira o resultado antes de repetir.';
 return {
  list:owner=>db.list(owner),
  async read(id,owner){const r=await db.read(id,owner);if(!r)throw new UserError('Lote não encontrado.',404);return r;},
  async begin(owner,item,count,requestId){if(!Number.isInteger(count)||count<1||count>20)throw new UserError('Escolha entre 1 e 20 anúncios por lote.');const old=await db.read(requestId,owner);if(old)return old;const source=await meli.replicationSource(item,owner);return db.create(requestId,owner,{source,copies:Array.from({length:count},()=>({title:source.sourceTitle,price:String(source.payload.price).replace('.',','),type:['gold_special','gold_pro'].includes(source.payload.listing_type_id)?source.payload.listing_type_id:'gold_special',status:'pending'})),finalState:'active'});},
  async submit(id,owner,copies,finalState,packaging){const row=await this.read(id,owner);if(row.status!=='editing')return {row,errors:{}};if(copies.length!==row.data.copies.length)throw new UserError('A quantidade de cópias mudou. Reabra o lote.');const packed=applyPackaging(row.data.source,packaging??row.data.source.packaging??readPackaging(row.data.source.payload));const errors={...validateCopies(row.data.source,copies),...packed.errors};if(!['active','paused'].includes(finalState))throw new UserError('Escolha o estado final dos anúncios.');if(Object.keys(errors).length)return {row:{...row,data:{...row.data,packagingInput:packaging,copies,finalState}},errors};await db.submit(id,owner,{...row.data,source:packed.source,finalState,copies:copies.map(c=>({title:c.title.trim(),price:String(priceValue(c.price??row.data.source.payload.price)),type:c.type,status:'pending'})),stage:'validate',index:0});return {row:await this.read(id,owner),errors:{}};},
  async retry(id,owner,index,acceptedFamily=''){
   if(!Number.isInteger(index)||index<0)throw new UserError('Cópia inválida.');
   const row=await this.read(id,owner),copy=row.data.copies[index];
   if(!copy||copy.status!=='partial'||!/^MLB\d+$/.test(copy.itemId)||copy.itemId===row.data.source.sourceId)throw new UserError('Somente cópias identificadas com pendência podem ser retomadas.',409);
   if(acceptedFamily&&acceptedFamily!==copy.reviewFamily)throw new UserError('O nome para revisão mudou. Atualize o resultado antes de confirmar.',409);
   const claim=await db.claimRetry(id,owner);if(!claim)return this.read(id,owner);const d=claim.data,c=d.copies[index];
   try{
    if(c?.status!=='partial'||c.itemId!==copy.itemId||acceptedFamily&&acceptedFamily!==c.reviewFamily)throw new UserError('Esta cópia já mudou. Reabra o resultado.',409);
    if(acceptedFamily)c.acceptedFamily=acceptedFamily;
    const snapshot=copySnapshot(d.source,c);
    c.retryStartedAt=new Date().toISOString();await db.checkpoint(id,owner,claim.token,d);
    const outcome=await meli.recoverReplication(c.itemId,owner,snapshot,d.finalState);
    c.itemStatus=outcome.status;c.status='completed';c.verified=true;c.description='saved';c.compatibilities='saved';c.message=outcome.status==='active'?'Anúncio concluído e ativo.':'Anúncio concluído e pausado.';delete c.reviewFamily;delete c.verificationDetails;
   }catch(e){c.status='partial';c.message=message(e);c.verificationDetails=e.diagnosticDetails;const name=e.diagnosticDetails?.changes?.find(x=>x.field==='payload.family_name');if(typeof name?.actual==='string'&&name.actual.trim())c.reviewFamily=name.actual;else delete c.reviewFamily;await recordFailure('replication.retry:'+id,{operation:'replication.retry',jobId:id,sourceId:d.source.sourceId,newId:c.itemId,...errorInfo(e)});}
   await db.finish(id,owner,claim.token,d,claim.status);return this.read(id,owner);
  },
  async advance(id,owner){const job=await db.claim(id,owner);if(!job)return this.read(id,owner);const d=job.data;let status='queued';try{
   const index=d.index,c=d.copies[index],snapshot=copySnapshot(d.source,c);
   if(d.stage==='validate'){
    const checked=await meli.validateReplication(snapshot,owner);c.warnings=checked.warnings||[];
    if(!checked.ok){c.status='rejected';c.message=checked.message;status='blocked';}
    else{c.status='validated';d.index++;if(d.index===d.copies.length){d.stage='publish';d.index=0;}}
   }else{
    c.status='sending';await db.checkpoint(id,owner,job.token,d);
    let created;try{created=await meli.createOfficialListing(snapshot,owner);}catch(e){c.status=e instanceof UserError&&!e.uncertain?'rejected':'unknown';c.message=message(e);if(c.status==='unknown')status='blocked';}
    if(created){c.itemId=created.id;c.itemStatus=created.status;c.status='created';await db.checkpoint(id,owner,job.token,d);
     try{
      c.itemStatus='não confirmado';await db.checkpoint(id,owner,job.token,d);c.itemStatus=await meli.pauseOfficialListing(created.id,owner);await db.checkpoint(id,owner,job.token,d);
      if(c.itemStatus!=='paused')throw new UserError('A pausa para completar os dados não foi confirmada.',409);
      await meli.describeOfficialListing(created.id,owner,snapshot.description);c.description='saved';await db.checkpoint(id,owner,job.token,d);
      await meli.applyReplicationCompatibilities(created.id,owner,snapshot.compatibilities);c.compatibilities='saved';await db.checkpoint(id,owner,job.token,d);
      await meli.verifyReplication(created.id,owner,snapshot);c.verified=true;await db.checkpoint(id,owner,job.token,d);
      if(d.finalState==='active'){c.itemStatus='não confirmado';await db.checkpoint(id,owner,job.token,d);c.itemStatus=await meli.activateReplication(created.id,owner);}
      c.status='completed';c.message=d.finalState==='active'?'Anúncio publicado.':'Anúncio criado e pausado.';
     }catch(e){c.status='partial';c.message=message(e);c.verificationDetails=e.diagnosticDetails;const name=e.diagnosticDetails?.changes?.find(x=>x.field==='payload.family_name');if(typeof name?.actual==='string'&&name.actual.trim())c.reviewFamily=name.actual;}
    }
    if(status!=='blocked'){d.index++;if(d.index===d.copies.length)status='complete';}
   }
  }catch(e){status='blocked';d.error=message(e);}await db.finish(id,owner,job.token,d,status);return this.read(id,owner);}
 };
}
