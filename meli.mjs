import {diagnosticContext,startApiCall,diagnosticDiff,recordFailure} from './diagnostics.mjs';
import {qualityData,editorLink} from './quality.mjs';
import {sameSource} from './replacement.mjs';
import {packageFields,packageId,readPackaging} from './replication-fields.mjs';
import {replicationSource,compatibilityPlan,normalizeTitle} from './replication.mjs';
import {makeDraft,preparePayload,pictureUrl} from './drafts.mjs';
import {UserError,challenge,random,hash} from './security.mjs';
const API='https://api.mercadolibre.com';
export function shippingSummary(data){
 const result={};
 for(const key of ['modes','shipping_modes'])if(Array.isArray(data?.[key]))result[key]=data[key].filter(v=>typeof v==='string').slice(0,30);
 if(Array.isArray(data?.logistics))result.logistics=data.logistics.slice(0,30).map(entry=>{
  const row={};for(const key of ['mode','type'])if(typeof entry?.[key]==='string')row[key]=entry[key].slice(0,100);
  if(Array.isArray(entry?.types))row.types=entry.types.slice(0,30).map(t=>typeof t==='string'?t:typeof t?.type==='string'?t.type:'não informado');
  return row;
 });
 return result;
}
export function createMeli({store,crypto,clientId,clientSecret,baseUrl,expectedSeller='',requireTestUser=false,fetcher=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let compatibilityTurn=Promise.resolve(),nextCompatibilityAt=0;
 async function paceCompatibility(){const turn=compatibilityTurn.then(async()=>{const delay=Math.max(0,nextCompatibilityAt-Date.now());if(delay)await sleep(delay);nextCompatibilityAt=Date.now()+750;});compatibilityTurn=turn.catch(()=>{});await turn;}
 const originalFetcher=fetcher;fetcher=async(url,options)=>{if(new URL(url).pathname.includes('/compatibilities'))await paceCompatibility();const end=startApiCall(url,options);let response;try{response=await originalFetcher(url,options);return response;}catch(e){await recordFailure('api.transport',{operation:'api.transport',origin:'transport',requestOutcome:'unconfirmed',endpoint:new URL(url).pathname,method:options?.method||'GET',message:'Não houve resposta HTTP confirmada.',errorType:e?.name});throw e;}finally{end(response);}};
 const redirectUri=baseUrl+'/oauth/mercadolivre/callback';
 async function call(path,{token,form,readAttempt=0}={}){
  const context=diagnosticContext.getStore();if(context)(context.secrets??=[]).push(...[token,form?.code,form?.code_verifier,form?.client_secret,form?.refresh_token].filter(v=>typeof v==='string'&&v.length>=4));
  let response;
  try{response=await fetcher(API+path,{method:form?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:form?{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'}:{Authorization:`Bearer ${token}`,Accept:'application/json',...(path.startsWith('/shipments/')?{'x-format-new':'true'}:{})},...(form?{body:new URLSearchParams(form)}:{})});}
  catch{throw new UserError('Não foi possível acessar o Mercado Livre. Tente novamente; se ocorreu durante a autorização, inicie uma nova conexão.',502);}
  let data;
  try{data=await response.json();}catch{throw new UserError('O Mercado Livre retornou uma resposta inesperada.',502);}
  if(response.status===429&&!form&&readAttempt<2){const raw=response.headers.get('retry-after');const delay=raw===null?750*2**readAttempt:/^\d+(?:\.\d+)?$/.test(raw)?Number(raw)*1000:Math.max(0,Date.parse(raw)-Date.now());if(Number.isFinite(delay)&&delay<=5000){await sleep(delay);return call(path,{token,readAttempt:readAttempt+1});}}
  if(!response.ok){
   const messages={401:'O acesso não foi autorizado. Reconecte sua conta.',403:'O Mercado Livre negou esta consulta. Confira as permissões do aplicativo e a conta autorizada.',404:'O recurso não foi encontrado no Mercado Livre.',429:'O limite de consultas foi atingido. Aguarde antes de tentar novamente.'};
   const error=new UserError(messages[response.status]||'O Mercado Livre não concluiu a solicitação. Confira a configuração e tente novamente.',response.status>=500?502:response.status);
   const code=typeof data?.error==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(data.error)?data.error:'';
   error.message+=' (HTTP '+response.status+(code?'; código '+code:'')+').';
   error.remoteStatus=response.status;error.diagnostic={endpoint:path.split('?')[0],method:form?'POST':'GET',code};throw error;
  }
  return data;
 }
 function normalize(data){
  if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0||!/^[0-9]+$/.test(String(data.user_id)))throw new UserError('A autorização não retornou os dados necessários. Confira o acesso offline e reconecte.',502);
  if(expectedSeller&&String(data.user_id)!==String(expectedSeller))throw new UserError('A conta autorizada não corresponde ao vendedor configurado.',403);
  return {user_id:String(data.user_id),encrypted:crypto.seal({access:data.access_token,refresh:data.refresh_token}),expires:now()+Number(data.expires_in)*1000,scope:String(data.scope||''),status:'ready'};
 }
 async function access(forceToken){
  return store.withConnection(async db=>{
   let row=await db.get();
   if(!row)throw new UserError('Conecte sua conta do Mercado Livre primeiro.',409);
   if(row.status!=='ready')throw new UserError('É necessário reconectar sua conta para renovar o acesso.',409);
   let tokens;
   try{tokens=crypto.open(row.encrypted);}catch{throw new UserError('Não foi possível abrir o acesso salvo. Confira a chave de proteção ou reconecte.',409);}
   if(Number(row.expires)>now()+60000&&(!forceToken||tokens.access!==forceToken))return tokens.access;
   // Commit the marker BEFORE using the one-time refresh token. No automatic replay after a crash or uncertain response.
   await db.save({...row,status:'refreshing'});
   try{
    const data=await call('/oauth/token',{form:{grant_type:'refresh_token',refresh_token:tokens.refresh,client_id:clientId,client_secret:clientSecret}});
    const next=normalize(data);
    if(next.user_id!==String(row.user_id))throw new UserError('A renovação retornou uma conta diferente. Reconecte.',409);
    await db.save(next);
    return data.access_token;
   }catch{
    await db.save({...row,status:'reconnect'});
    throw new UserError('A renovação não pôde ser confirmada. Reconecte sua conta; o código anterior não será reutilizado.',409);
   }
  });
 }
 async function get(path){
  const token=await access();
  try{return await call(path,{token});}
  catch(error){if(error.remoteStatus!==401)throw error;const renewed=await access(token);return call(path,{token:renewed});}
 }
 async function testAccess(expected){
  if(!requireTestUser)throw new UserError('Publicação disponível somente na conexão de teste.',403);
  const registered=await store.expectedSeller();
  if(!registered||String(registered)!==String(expected))throw new UserError('A conta de teste não corresponde ao cadastro deste aplicativo.',403);
  let token=await access();let profile;
  try{profile=await call('/users/me',{token});}catch(error){if(error.remoteStatus!==401)throw error;token=await access(token);profile=await call('/users/me',{token});}
  if(String(profile.id)!==String(expected)||!profile.tags?.includes('test_user')||profile.site_id!=='MLB')throw new UserError('Envio bloqueado: a conta precisa ser a conta brasileira de teste cadastrada.',403);
  return {token,profile};
 }
 async function officialAccess(expected){
  if(requireTestUser)throw new UserError('Use a conexão da conta oficial.',403);
  let token=await access(),profile;
  try{profile=await call('/users/me',{token});}catch(e){if(e.remoteStatus!==401)throw e;token=await access(token);profile=await call('/users/me',{token});}
  if(String(profile.id)!==String(expected)||profile.site_id!=='MLB'||profile.tags?.includes('test_user'))throw new UserError('A conta oficial conectada não corresponde ao destino revisado.',403);
  return {token,profile};
 }
 async function ownedOfficial(itemId,expected){
  const {token,profile}=await officialAccess(expected);
  if(!/^MLB[0-9]+$/.test(itemId))throw new UserError('Código de anúncio inválido.');
  const item=await call('/items/'+itemId,{token});
  if(String(item.seller_id)!==String(expected))throw new UserError('O anúncio não pertence à conta oficial.',403);
  return {token,item,profile};
 }
 async function assertUnsold(item,owner){
  if(item.sold_quantity!==0)throw new UserError('O anúncio já tem vendas ou o contador não pôde ser confirmado. O original não será excluído.',409);
  const q=new URLSearchParams({seller:String(owner),item:item.id,limit:'1'}),orders=await get('/orders/search?'+q);
  if(!Array.isArray(orders.results)||!Number.isSafeInteger(orders.paging?.total))throw new UserError('Não foi possível conferir os pedidos do anúncio. Exclusão bloqueada.',502);
  if(orders.paging.total!==0||orders.results.length)throw new UserError('Há pedidos associados ao anúncio. A substituição foi bloqueada para preservar o original.',409);
 }
 async function mutation(path,token,body,method='POST'){
  let response;
  try{response=await fetcher(API+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});}
  catch{const e=new UserError('Não foi possível confirmar a resposta. O envio não será repetido automaticamente.',502);e.uncertain=true;throw e;}
  let data;try{data=await response.json();}catch{const e=new UserError('A resposta não pôde ser interpretada. Confira o resultado antes de outra tentativa.',502);e.uncertain=true;throw e;}
  if(!response.ok){
   const causes=Array.isArray(data.cause)?data.cause:[];
   const message=causes.slice(0,12).map(c=>[c?.code,c?.message].filter(v=>typeof v==='string').join(': ').slice(0,1200)).filter(Boolean).join('\n');
   const e=new UserError('Mercado Livre retornou HTTP '+response.status+'. '+(message||String(data.message||data.error||'Solicitação recusada.').slice(0,500)),response.status>=500?502:response.status);
   e.uncertain=response.status>=500;e.remoteStatus=response.status;e.diagnostic={endpoint:path,method,causes:causes.slice(0,12).map(c=>({code:c.code,type:c.type,message:c.message})),fields:Object.keys(body||{})};throw e;
  }
  return data;
 }
 return {
  redirectUri,
  async metricsProfile(owner){return (await officialAccess(owner)).profile;},
  async qualityItem(id,owner){
   const row=await this.catalogItem(id,owner);const item=await get('/items/'+id);
   if(item.id!==id||String(item.seller_id)!==String(owner))throw new UserError('Anúncio de outra conta.',403);
   try{const product=item.user_product_id;if(product&&!/^MLBU[0-9]+$/.test(product))throw new UserError('Produto inválido.',502);const data=await get(product?'/user-product/'+product+'/performance':'/item/'+id+'/performance');return {...row,...qualityData(data,item)};}
   catch(e){return {...row,score:null,qualityUnavailable:e.remoteStatus===404,editUrl:editorLink(null,id),qualityError:e.remoteStatus===404?'Avaliação ainda não disponível.':e instanceof UserError?e.message:'Não foi possível interpretar a avaliação.'};}
  },
  async catalogItem(id,owner){
   if(!/^MLB\d+$/.test(id))throw new UserError('Código de anúncio inválido.');
   const item=await get('/items/'+id);
   if(item.id!==id||String(item.seller_id)!==String(owner))throw new UserError('Anúncio de outra conta.',403);
   return {id,title:String(item.title||item.family_name||id),status:item.status,created:item.date_created,price:item.price,currency:item.currency_id,permalink:item.permalink,quantity:item.available_quantity,sold:item.sold_quantity,skus:[...new Set([item.seller_custom_field,...(item.attributes||[]).filter(a=>a.id==='SELLER_SKU').map(a=>a.value_name),...(item.variations||[]).flatMap(v=>[v.seller_custom_field,...(v.attributes||[]).filter(a=>a.id==='SELLER_SKU').map(a=>a.value_name)])].filter(Boolean))]};
  },
  async dashboardOrders(owner,{from,to,offset=0,paidOnly=false,cancelledOnly=false}){
   const params=new URLSearchParams({seller:String(owner),'order.date_created.from':from,'order.date_created.to':to,sort:'date_desc',limit:'50',offset:String(offset)});
   if(paidOnly||cancelledOnly)params.set('order.status',paidOnly?'paid':'cancelled');
   let data;try{data=await get('/orders/search?'+params);}catch(error){if(error instanceof UserError)throw new UserError('Consulta de pedidos '+(cancelledOnly?'cancelados':'da conta')+': '+error.message,error.status);throw error;}
   if(!Array.isArray(data.results)||!Number.isSafeInteger(data.paging?.total)||data.paging.total<0||data.paging.offset!==offset)throw new UserError('Não foi possível confirmar a paginação das vendas.',502);
   const rows=data.results.map(o=>{
    if(String(o.seller?.id)!==String(owner)||!/^\d+$/.test(String(o.id))||!Number.isFinite(Date.parse(o.date_created))||Date.parse(o.date_created)<Date.parse(from)||Date.parse(o.date_created)>Date.parse(to))throw new UserError('A consulta retornou um pedido fora da conta ou do período.',502);
    if(!Array.isArray(o.order_items)||!o.order_items.length||o.currency_id!=='BRL'||o.order_items.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<1||!Number.isFinite(i.unit_price)||i.unit_price<0))throw new UserError('Valores de venda incompletos. O resumo anterior foi preservado.',502);
    return {id:String(o.id),status:String(o.status),created:o.date_created,closed:o.date_closed||null,grossCents:o.order_items.reduce((n,i)=>n+Math.round(i.unit_price*100)*i.quantity,0),units:o.order_items.reduce((n,i)=>n+i.quantity,0),title:String(o.order_items[0].item?.title||'Pedido'),shipment:/^\d+$/.test(String(o.shipping?.id))?String(o.shipping.id):null};
   });
   return {rows,total:data.paging.total};
  },
  async dashboardShipment(id,owner){
   if(!/^\d+$/.test(String(id)))throw new UserError('Envio inválido.');
   const s=await get('/shipments/'+id);
   if(String(s.id)!==String(id)||String(s.origin?.sender_id??s.sender_id)!==String(owner))throw new UserError('Envio de outra conta.',403);
   const result={id:String(id),status:s.status,substatus:s.substatus,logistic:s.logistic?.type||s.logistic_type};
   if(['delivered','not_delivered','cancelled','shipped'].includes(s.status)||['picked_up','authorized_by_carrier','in_hub'].includes(s.substatus)||result.logistic==='fulfillment')return result;
   try{const sla=await get('/shipments/'+id+'/sla');result.deadline=Number.isFinite(Date.parse(sla.expected_date))?sla.expected_date:null;result.slaStatus=sla.status;}
   catch{result.error='Prazo de despacho indisponível.';}
   return result;
  },
  async metricsScan(owner,cursor){
   if(!/^[0-9]+$/.test(String(owner)))throw new UserError('Vendedor inválido.');
   const q=new URLSearchParams({search_type:'scan',limit:'100'});
   if(cursor)q.set('scroll_id',cursor);
   const data=await get('/users/'+owner+'/items/search?'+q);
   if(data===null)return {ids:[],total:null,cursor:null,done:true};
   const ids=data.results===null?[]:data.results;
   if(!Array.isArray(ids)||ids.some(id=>!/^MLB[0-9]+$/.test(id)))throw new UserError('A listagem de anúncios retornou dados inesperados.',502);
   const total=Number.isSafeInteger(data.paging?.total)?data.paging.total:null;
   if(ids.length&&!data.scroll_id)throw new UserError('A listagem não retornou a continuação necessária. Não será apresentada como completa.',502);
   return {ids,total,cursor:data.scroll_id||null,done:ids.length===0};
  },
  async metricsItem(id,owner){
   if(!/^MLB[0-9]+$/.test(id))throw new UserError('Anúncio inválido.');
   const item=await get('/items/'+id);
   if(item.id!==id||String(item.seller_id)!==String(owner))throw new UserError('Anúncio fora da conta conectada.',403);
   const at=now(),from=new Date(at-180*86400000).toISOString();
   const row={id,title:String(item.title||item.family_name||id),status:String(item.status||'não informado'),created:item.date_created||null,parent:item.parent_item_id||null,sold:Number.isSafeInteger(item.sold_quantity)&&item.sold_quantity>=0?item.sold_quantity:null,price:typeof item.price==='number'?item.price:null,checkedAt:new Date(at).toISOString()};
   const skuValues=[item.attributes?.find(a=>a.id==='SELLER_SKU')?.value_name,item.seller_custom_field,...(item.variations||[]).flatMap(v=>[v.attributes?.find(a=>a.id==='SELLER_SKU')?.value_name,v.seller_custom_field])];
   row.skus=[...new Set(skuValues.filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim().slice(0,200)))];
   const q=new URLSearchParams({seller:String(owner),item:id,'order.status':'paid',sort:'date_desc',limit:'1','order.date_closed.from':from});
   const [visits,sales]=await Promise.allSettled([get('/visits/items?'+new URLSearchParams({ids:id})),get('/orders/search?'+q)]);
   if(visits.status==='fulfilled'&&Number.isSafeInteger(visits.value?.[id])&&visits.value[id]>=0)row.visits={total:visits.value[id]};
   else row.visits={error:visits.status==='rejected'&&visits.reason instanceof UserError?visits.reason.message:'Total de visitas não retornado.'};
   if(sales.status==='fulfilled'){
    const data=sales.value,orders=data.results,total=data.paging?.total;
    if(!Array.isArray(orders)||!Number.isSafeInteger(total)||total<0||!orders.length&&total!==0)row.sales={ok:false,error:'Resposta de pedidos incompleta.'};
    else if(!orders.length)row.sales={ok:true,lastPaid:null,from};
    else {
     const order=orders[0],date=Date.parse(order.date_closed);
     if(order.status!=='paid'||String(order.seller?.id)!==String(owner)||!order.order_items?.some(line=>line.item?.id===id)||!Number.isFinite(date)||date<Date.parse(from)||data.sort?.id!=='date_desc')row.sales={ok:false,error:'Não foi possível confirmar a última venda deste anúncio.'};
     else row.sales={ok:true,lastPaid:new Date(date).toISOString(),from};
    }
   }else row.sales={ok:false,error:sales.reason instanceof UserError?sales.reason.message:'Consulta de pedidos indisponível.'};
   row.visitPeriods={};
   // Keep the intervals explicit. Missing or malformed responses never mean zero.
   for(const days of [30,60,90]){
    const start=new Date(at-days*86400000).toISOString(),end=new Date(at).toISOString();
    try{
     const data=await get('/items/visits?'+new URLSearchParams({ids:id,date_from:start,date_to:end}));
     const begin=Date.parse(data?.date_from),finish=Date.parse(data?.date_to);
     if(data?.item_id!==id||!Number.isSafeInteger(data.total_visits)||data.total_visits<0||!Number.isFinite(begin)||!Number.isFinite(finish)||Math.abs(begin-Date.parse(start))>1000||Math.abs(finish-at)>1000)throw new UserError('O período de visitas não foi confirmado pela API.',502);
     row.visitPeriods[days]={total:data.total_visits,from:data.date_from,to:data.date_to};
    }catch(e){row.visitPeriods[days]={error:e instanceof UserError?e.message:'Consulta de visitas indisponível.'};}
   }
   return row;
  },

  async recoverReplacement(d,owner){
   if(!d.newId||d.newId===d.source.sourceId)throw new UserError('Não há uma cópia identificada para retomar.',409);
   const old=(await ownedOfficial(d.source.sourceId,owner)).item,next=(await ownedOfficial(d.newId,owner)).item;
   if(old.sub_status?.includes('deleted'))return {stage:'done',oldStatus:'deleted',newStatus:next.status};
   if(!['active','paused','closed'].includes(old.status)||!['active','paused'].includes(next.status))throw new UserError('Os anúncios estão em um estado que exige conferência no Mercado Livre.',409);
   await assertUnsold(old,owner);
   if(old.status==='closed'){await this.verifyReplication(d.newId,owner,d.snapshot);if(next.status!==d.source.originalStatus)throw new UserError('Confira o status da cópia antes de concluir a exclusão.',409);return {stage:'delete_old',oldStatus:'closed',newStatus:next.status};}
   const current=await this.replicationSource(d.source.sourceId,owner);if(!sameSource(current,d.source)){const error=new UserError('Os dados do anúncio original mudaram. A cópia existente precisa ser conferida; outra não será criada.',409);error.diagnosticDetails=diagnosticDiff(d.source,current);throw error;}
   let stage=d.stage,remainingCompat;
   if(stage==='pause_new'&&next.status==='paused')stage='description';
   if(stage==='description'){
    const desc=await get('/items/'+d.newId+'/description').catch(e=>{if(e.remoteStatus===404)return {plain_text:''};throw e;});
    if(desc.plain_text===d.snapshot.description)stage='compatibilities';else if(desc.plain_text)throw new UserError('A descrição da cópia difere do original. Confira os dois anúncios.',409);
   }
   if(stage==='compatibilities'){
    const raw=await get('/items/'+d.newId+'/compatibilities?extended=true').catch(e=>{if(e.remoteStatus===404)return {products:[]};throw e;});const got=compatibilityPlan(raw),expected=d.snapshot.compatibilities;
    const equal=(a,b)=>sameSource({compatibilities:[a]},{compatibilities:[b]});
    if(got.some(a=>!expected.some(b=>equal(a,b))))throw new UserError('A cópia possui compatibilidades divergentes. Confira antes de retomar.',409);
    remainingCompat=expected.filter(b=>!got.some(a=>equal(a,b)));if(!remainingCompat.length)stage='verify';
   }
   if(stage==='activate_new'&&next.status==='active')stage='pause_old';
   if(stage==='pause_old'&&old.status==='paused')stage='close_old';
   return {stage,oldStatus:old.status,newStatus:next.status,remainingCompat};
  },
  async replacementSource(id,owner){
   const {item}=await ownedOfficial(id,owner);if(!['active','paused'].includes(item.status))throw new UserError('Somente anúncios ativos ou pausados podem ser substituídos neste fluxo. O original não foi alterado.',409);
   await assertUnsold(item,owner);const source=await this.replicationSource(id,owner);return {...source,originalStatus:item.status};
  },
  async checkReplacementPair(source,snapshot,newId,owner,paused){
   if(newId===source.sourceId)throw new UserError('O novo anúncio precisa ter um código diferente do original.',403);
   const current=await this.replacementSource(source.sourceId,owner);if(!sameSource(source,current)){const error=new UserError('Os dados do original mudaram. A exclusão foi bloqueada.',409);error.diagnosticDetails=diagnosticDiff(source,current);throw error;}
   if(current.originalStatus!==(paused?'paused':source.originalStatus))throw new UserError('O status do original mudou. A exclusão foi bloqueada.',409);
   await this.verifyReplication(newId,owner,snapshot);const {item}=await ownedOfficial(newId,owner);
   if(item.status!==source.originalStatus)throw new UserError('O novo anúncio não confirmou o status esperado. O original não será excluído.',409);
  },
  async closeReplacementOriginal(oldId,newId,owner){
   if(oldId===newId)throw new UserError('Códigos de anúncios inválidos.',403);
   const {token,item}=await ownedOfficial(oldId,owner);await ownedOfficial(newId,owner);if(item.status!=='paused')throw new UserError('O original precisa estar pausado antes do encerramento.',409);await assertUnsold(item,owner);
   const result=await mutation('/items/'+oldId,token,{status:'closed'},'PUT');if(result.status!=='closed')throw new UserError('Encerramento do original não confirmado. Confira o resultado.',409);return 'closed';
  },
  async deleteReplacementOriginal(source,snapshot,newId,owner){
   if(source.sourceId===newId)throw new UserError('Códigos de anúncios inválidos.',403);
   const {token,item}=await ownedOfficial(source.sourceId,owner);if(item.status!=='closed')throw new UserError('O original não está encerrado. A exclusão não foi enviada.',409);await assertUnsold(item,owner);
   await this.verifyReplication(newId,owner,snapshot);const next=await ownedOfficial(newId,owner);if(next.item.status!==source.originalStatus)throw new UserError('O novo anúncio mudou de status. A exclusão não foi enviada.',409);
   await mutation('/items/'+source.sourceId,token,{deleted:true},'PUT');const confirmed=await ownedOfficial(source.sourceId,owner);if(!confirmed.item.sub_status?.includes('deleted'))throw new UserError('A exclusão foi enviada, mas não confirmada. Confira os anúncios; não repita a criação.',409);
  },
  async replicationSource(id,owner){
   const {profile,item}=await ownedOfficial(id,owner);
   const [category,schema]=await Promise.all([get('/categories/'+item.category_id),get('/categories/'+item.category_id+'/attributes')]);
   let description;try{description=await get('/items/'+id+'/description');}catch(e){if(e.remoteStatus===404)description={plain_text:''};else throw e;}
   let compatibility;try{compatibility=await get('/items/'+id+'/compatibilities?extended=true');}catch(e){if(e.remoteStatus===404&&!item.attributes?.some(a=>a.id==='HAS_COMPATIBILITIES'&&(a.value_id==='242085'||String(a.value_name).toLowerCase()==='sim')))compatibility={products:[]};else throw e;}
   const source=replicationSource({item,profile,category,schema,description,compatibility});
   if(source.compatibilities.length>6000)throw new UserError('Este anúncio ultrapassa 6.000 compatibilidades. Confira o limite antes de replicar.',409);
   return source;
  },
  async validateReplication(snapshot,owner){
   const {token}=await officialAccess(owner);if(snapshot.sellerId!==String(owner))throw new UserError('Lote de outra conta.',403);
   let response;try{response=await fetcher(API+'/items/validate',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(snapshot.payload)});}catch{throw new UserError('O validador não respondeu. Nenhum anúncio deste lote foi enviado.',502);}
   if(response.status===204)return {ok:true};
   let data;try{data=await response.json();}catch{throw new UserError('Resposta inesperada na validação do lote.',502);}
   const causes=Array.isArray(data.cause)?data.cause:[],warnings=causes.filter(c=>c.type==='warning').map(c=>String(c.code||'')+': '+String(c.message||''));
   if(response.status===400&&causes.length&&causes.every(c=>c.type==='warning'))return {ok:true,warnings};
   if(response.ok&&data.valid===true)return {ok:true,warnings};
   return {ok:false,remoteStatus:response.status,diagnostic:{endpoint:'/items/validate',method:'POST',causes:causes.slice(0,15).map(c=>({code:c.code,type:c.type,message:c.message}))},message:'Validação recusada (HTTP '+response.status+'). '+causes.slice(0,15).map(c=>String(c.code||'')+': '+String(c.message||'')).join(' '),warnings};
  },
  async applyReplicationCompatibilities(id,owner,products){
   if(!products.length)return;
   const {token,item}=await ownedOfficial(id,owner);
   const groups=new Map();for(const p of products){if(!groups.has(p.domain))groups.set(p.domain,[]);const {domain,...body}=p;groups.get(domain).push({...body,creation_source:'DEFAULT'});}
   for(const [domain,rows] of groups){const path=item.user_product_id?'/user-products/'+encodeURIComponent(item.user_product_id)+'/compatibilities':'/items/'+id+'/compatibilities';
    for(let offset=0;offset<rows.length;offset+=200)await mutation(path,token,{...(item.user_product_id?{domain_id:domain,category_id:item.category_id}:{}),products:rows.slice(offset,offset+200)});
   }
  },
  async verifyReplication(id,owner,snapshot,{core=false}={}){
   const {item}=await ownedOfficial(id,owner),expected=snapshot.payload;
   const differences=[];if(snapshot.expectedDisplayTitle&&item.title!==snapshot.expectedDisplayTitle)differences.push('título original');for(const key of ['price','currency_id','available_quantity','condition','listing_type_id','category_id','seller_custom_field','title','family_name'])if(expected[key]!=null&&item[key]!==expected[key]&&!(key==='family_name'&&!snapshot.expectedDisplayTitle&&normalizeTitle(item[key])===normalizeTitle(expected[key])))differences.push(key);
   const sameValue=(a,b)=>{if(!b)return false;if(a.value_id!=null)return String(a.value_id)===String(b.value_id);if(a.values)return JSON.stringify(a.values.map(v=>v.id??v.name).sort())===JSON.stringify((b.values||[]).map(v=>v.id??v.name).sort());return String(a.value_name??'')===String(b.value_name??'');};
   for(const a of expected.attributes||[])if(!packageFields.some(([k])=>packageId(k)===a.id)&&!sameValue(a,item.attributes?.find(b=>b.id===a.id)))differences.push('atributo '+a.id);
   if(expected.attributes?.some(a=>packageFields.some(([k])=>packageId(k)===a.id))){const wanted=readPackaging(expected),received=readPackaging(item);if(wanted.weight!==received.weight||JSON.stringify([wanted.height,wanted.width,wanted.length].sort())!==JSON.stringify([received.height,received.width,received.length].sort()))differences.push('embalagem');}
   for(const a of expected.sale_terms||[])if(!sameValue(a,item.sale_terms?.find(b=>b.id===a.id)))differences.push('condição '+a.id);
   if(JSON.stringify(expected.pictures.map(p=>p.id).sort())!==JSON.stringify((item.pictures||[]).map(p=>p.id).sort()))differences.push('fotos');
   for(const key of ['mode','free_shipping','local_pick_up'])if(expected.shipping?.[key]!=null&&expected.shipping[key]!==item.shipping?.[key])differences.push('envio '+key);
   const fail=()=>{const error=new UserError('Anúncio criado, mas a conferência encontrou diferença em: '+differences.join(', ')+'. Confira os valores antes de concluir.',409);const diff=diagnosticDiff({payload:expected},{payload:Object.fromEntries(Object.keys(expected).map(k=>[k,item[k]]))});diff.changes=diff.changes.filter(c=>c.field!=='payload.family_name');if(differences.includes('family_name'))diff.changes.unshift({field:'payload.family_name',expected:expected.family_name,actual:item.family_name??null});if(diff.changes.length>40){diff.changes=diff.changes.slice(0,40);diff.truncated=true;}error.diagnosticDetails={differences,...diff};throw error;};
   if(core){if(differences.length)fail();return;}
   const description=await get('/items/'+id+'/description').catch(e=>{if(e.remoteStatus===404)return {plain_text:''};throw e;});if(description.plain_text!==snapshot.description)differences.push('descrição');
   const compat=await get('/items/'+id+'/compatibilities?extended=true').catch(e=>{if(e.remoteStatus===404&&!snapshot.compatibilities.length)return {products:[]};throw e;});
   const got=compatibilityPlan(compat),canonical=p=>JSON.stringify([p.id,p.domain,p.note||'',p.restrictions||[]]);const expectedSet=new Set(snapshot.compatibilities.map(canonical));if(got.length!==expectedSet.size||got.some(p=>!expectedSet.has(canonical(p))))differences.push('compatibilidades');
   if(differences.length)fail();
  },
  async recoverReplication(id,owner,snapshot,finalState){
   if(id===snapshot.sourceId||!/^MLB\d+$/.test(id)||!['active','paused'].includes(finalState))throw new UserError('Cópia ou estado final inválido.',409);
   let {item}=await ownedOfficial(id,owner);
   if(item.id!==id)throw new UserError('O anúncio retornado não corresponde à cópia.',409);
   if(!['active','paused'].includes(item.status))throw new UserError('Confira o estado deste anúncio no Mercado Livre antes de retomar.',409);
   await this.verifyReplication(id,owner,snapshot,{core:true});
   const description=await get('/items/'+id+'/description').catch(e=>{if(e.remoteStatus===404)return {plain_text:''};throw e;});
   if(typeof description.plain_text!=='string')throw new UserError('Não foi possível confirmar a descrição existente.',409);
   if(description.plain_text&&description.plain_text!==snapshot.description)throw new UserError('A descrição existente difere da esperada. Ela não será sobrescrita.',409);
   const raw=await get('/items/'+id+'/compatibilities?extended=true').catch(e=>{if(e.remoteStatus===404&&!item.attributes?.some(a=>a.id==='HAS_COMPATIBILITIES'&&(a.value_id==='242085'||String(a.value_name).toLowerCase()==='sim')))return {products:[]};throw e;});
   const got=compatibilityPlan(raw),expected=snapshot.compatibilities;
   const equal=(a,b)=>sameSource({compatibilities:[a]},{compatibilities:[b]});
   if(got.some(a=>!expected.some(b=>equal(a,b))))throw new UserError('Existem compatibilidades diferentes das esperadas. Confira o anúncio antes de retomar.',409);
   const missing=expected.filter(b=>!got.some(a=>equal(a,b)));
   if(description.plain_text!==snapshot.description||missing.length){
    if(item.status!=='paused'){const status=await this.pauseOfficialListing(id,owner);if(status!=='paused')throw new UserError('Pausa da cópia não confirmada.',409);item.status=status;}
    if(description.plain_text!==snapshot.description)await this.describeOfficialListing(id,owner,snapshot.description);
    if(missing.length)await this.applyReplicationCompatibilities(id,owner,missing);
   }
   await this.verifyReplication(id,owner,snapshot);
   item=(await ownedOfficial(id,owner)).item;
   if(item.id!==id||!['active','paused'].includes(item.status))throw new UserError('O estado da cópia mudou durante a conferência.',409);
   if(item.status!==finalState){const status=finalState==='active'?await this.activateReplication(id,owner):await this.pauseOfficialListing(id,owner);if(status!==finalState)throw new UserError('Estado final não confirmado.',409);item.status=status;}
   return {status:item.status};
  },
  async activateReplication(id,owner){const {token}=await ownedOfficial(id,owner);const result=await mutation('/items/'+id,token,{status:'active'},'PUT');if(result.status!=='active')throw new UserError('Ativação não confirmada. Confira o anúncio criado.',409);return 'active';},
  async prepareOfficial(draft,expected){
   const {profile}=await officialAccess(expected);
   if(draft.sellerId!==String(expected))throw new UserError('O rascunho pertence a outra conta.',403);
   const [category,schema,shipping]=await Promise.all([get('/categories/'+draft.categoryId),get('/categories/'+draft.categoryId+'/attributes'),get('/users/'+encodeURIComponent(expected)+'/shipping_preferences')]);
   if(category.id!==draft.categoryId||!Array.isArray(schema))throw new UserError('Ficha técnica indisponível.',502);
   const copy=structuredClone(draft);copy.mode=profile.tags?.includes('user_product_seller')?'family':'title';
   const prepared=preparePayload(copy,schema,category.settings||{});
   if(prepared.issues.length)throw new UserError(prepared.issues.join(' '));
   const modes=shipping.modes||shipping.shipping_modes||profile.shipping_modes||[];
   if(!prepared.payload.shipping?.mode||!modes.includes(prepared.payload.shipping.mode))throw new UserError('A modalidade de envio do rascunho não está habilitada na conta. Revise o frete antes de publicar.',409);
   if(draft.validation&&!draft.validation.ok&&draft.validation.outcome!=='warnings_only')throw new UserError('O rascunho tem pendências de validação. Corrija os campos e valide novamente.',409);
   return {kind:'official',sellerId:String(profile.id),sellerName:String(profile.nickname||profile.id),sourceId:draft.sourceId,payload:prepared.payload,description:copy.values.description,validation:copy.validation||null};
  },
  async createOfficialListing(snapshot,expected){
   const {token}=await officialAccess(expected);
   if(snapshot.kind!=='official'||snapshot.sellerId!==String(expected)||snapshot.payload.id||snapshot.payload.user_product_id||snapshot.payload.catalog_product_id)throw new UserError('Prévia inválida para publicação.',403);
   const item=await mutation('/items',token,snapshot.payload);
   if(!/^MLB[0-9]+$/.test(item.id||'')||String(item.seller_id)!==String(expected)||item.id===snapshot.sourceId){const e=new UserError('Resposta de criação inesperada. Confira a conta antes de tentar novamente.',502);e.uncertain=true;throw e;}
   return {id:item.id,status:String(item.status||'não informado')};
  },
  async pauseOfficialListing(itemId,expected){
   const {token,item}=await ownedOfficial(itemId,expected);
   if(item.status==='closed')return 'closed';
   const result=await mutation('/items/'+itemId,token,{status:'paused'},'PUT');
   if(result.status!=='paused')throw new UserError('A pausa não foi confirmada. Confira o anúncio no Mercado Livre.',409);
   return 'paused';
  },
  async describeOfficialListing(itemId,expected,description){
   const {token}=await ownedOfficial(itemId,expected);
   if(description.trim())await mutation('/items/'+itemId+'/description',token,{plain_text:description});
  },

  async createTestUser(){
   if(requireTestUser)throw new UserError('Use a conexão principal para gerar a conta de teste.',403);
   const token=await access();const result=await mutation('/users/test_user',token,{site_id:'MLB'});
   if(!/^[0-9]+$/.test(String(result.id))||!result.nickname||!result.password){const e=new UserError('A criação da conta retornou dados incompletos. Não repita automaticamente.',502);e.uncertain=true;throw e;}
   return {id:String(result.id),nickname:String(result.nickname),password:String(result.password)};
  },
  async prepareTest(draft,expected){
   const {profile}=await testAccess(expected);
   const [category,schema]=await Promise.all([get('/categories/'+draft.categoryId),get('/categories/'+draft.categoryId+'/attributes')]);
   if(category.id!==draft.categoryId||!Array.isArray(schema))throw new UserError('Não foi possível consultar a categoria do teste.',502);
   const copy=structuredClone(draft);copy.sellerId=String(profile.id);copy.mode=profile.tags.includes('user_product_seller')?'family':'title';copy.officialStoreId=null;
   copy.values.name='Item de Teste - Por favor, NAO OFERTAR!';copy.values.quantity='1';copy.values.listingType='gold_special';
   const modes=Array.isArray(profile.shipping_modes)?profile.shipping_modes:[];
   if(modes.includes('me2'))copy.shipping={mode:'me2',free_shipping:true,local_pick_up:false};
   else if(modes.includes('not_specified'))copy.shipping={mode:'not_specified',free_shipping:false,local_pick_up:true};
   else throw new UserError('A conta de teste não retornou uma modalidade de envio compatível com este fluxo.',409);
   const prepared=preparePayload(copy,schema,category.settings||{});
   if(prepared.issues.length)throw new UserError(prepared.issues.join(' '));
   const pictures=copy.values.pictureIds.map(id=>pictureUrl(copy.pictures.find(p=>p.id===id)?.url));
   if(pictures.some(url=>!url))throw new UserError('Uma foto não tem endereço utilizável. Consulte o anúncio e crie outro rascunho para atualizar as fotos.');
   prepared.payload.pictures=pictures.map(source=>({source}));
   return {payload:prepared.payload,description:'ITEM DE TESTE - POR FAVOR, NAO OFERTAR!\n\n'+copy.values.description.slice(0,49000),sellerId:String(profile.id),mode:copy.mode};
  },
  async createTestListing(snapshot,expected){
   const {token}=await testAccess(expected);
   if(snapshot.sellerId!==String(expected)||snapshot.payload.available_quantity!==1||snapshot.payload.listing_type_id!=='gold_special'||(snapshot.payload.family_name||snapshot.payload.title)!=='Item de Teste - Por favor, NAO OFERTAR!'||snapshot.payload.official_store_id!=null||snapshot.payload.user_product_id!=null)throw new UserError('Dados de teste inválidos. Prepare o teste novamente.',403);
   const item=await mutation('/items',token,snapshot.payload);
   if(!/^MLB[0-9]+$/.test(item.id||'')||String(item.seller_id)!==String(expected)){const e=new UserError('A criação retornou identificação inesperada. Confira a conta de teste antes de outra tentativa.',502);e.uncertain=true;throw e;}
   return {id:item.id,status:String(item.status||'não informado')};
  },
  async describeTestListing(itemId,expected,description){
   const {token}=await testAccess(expected);
   if(!/^MLB[0-9]+$/.test(itemId))throw new UserError('Anúncio de teste inválido.');
   const item=await call('/items/'+itemId,{token});
   if(String(item.seller_id)!==String(expected))throw new UserError('Anúncio fora da conta de teste.',403);
   await mutation('/items/'+itemId+'/description',token,{plain_text:description});
  },
  async pauseTestListing(itemId,expected){
   const {token}=await testAccess(expected);
   if(!/^MLB[0-9]+$/.test(itemId))throw new UserError('Anúncio de teste inválido.');
   const item=await call('/items/'+itemId,{token});
   if(String(item.seller_id)!==String(expected))throw new UserError('Anúncio fora da conta de teste.',403);
   if(item.status==='paused'||item.status==='closed')return String(item.status);
   const result=await mutation('/items/'+itemId,token,{status:'paused'},'PUT');
   if(result.status!=='paused')throw new UserError('A pausa ainda não foi confirmada pelo Mercado Livre.',409);
   return 'paused';
  },
  async draftSource(itemId){
   const result=await this.inspect(itemId);
   if(!/^MLB[0-9]+$/.test(result.item.category_id||''))throw new UserError('Categoria do anúncio inválida.',502);
   const [category,schema]=await Promise.all([get('/categories/'+result.item.category_id),get('/categories/'+result.item.category_id+'/attributes')]);
   return makeDraft(result,category,schema);
  },
  async validateDraft(draft){
   const profile=await get('/users/me');
   if(String(profile.id)!==draft.sellerId)throw new UserError('O rascunho pertence a outra conta.',403);
   const [category,schema]=await Promise.all([get('/categories/'+draft.categoryId),get('/categories/'+draft.categoryId+'/attributes')]);
   if(!Array.isArray(schema)||category.id!==draft.categoryId)throw new UserError('A ficha técnica da categoria está indisponível.',502);
   const activeMode=profile.tags?.includes('user_product_seller')?'family':'title';
   if(activeMode==='family'&&draft.mode!=='family')throw new UserError('O modelo de publicação da conta mudou. Crie um novo rascunho a partir do anúncio.',409);
   const prepared=preparePayload(draft,schema,category.settings||{});
   if(prepared.issues.length)return {ok:false,stage:'local',issues:prepared.issues,checkedAt:new Date(now()).toISOString()};
   const token=await access();
   const send=async current=>{
    try{return await fetcher(API+'/items/validate',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+current,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(prepared.payload)});}
    catch{throw new UserError('O validador do Mercado Livre não respondeu. O rascunho foi salvo; tente validar novamente.',502);}
   };
   let response=await send(token);
   if(response.status===401)response=await send(await access(token));
   if(response.status===204)return {ok:true,stage:'remote',issues:[],checkedAt:new Date(now()).toISOString()};
   if([400,422].includes(response.status)){
    let data;try{data=await response.json();}catch{throw new UserError('Resposta inesperada do validador. O rascunho permanece salvo.',502);}
    const causes=Array.isArray(data.cause)?data.cause:[];
    const issues=[],warnings=[];
    for(const cause of causes.slice(0,60)){
     const message=[cause.code,cause.message].filter(x=>typeof x==='string').join(': ').slice(0,1800);
     if(message)(cause.type==='warning'?warnings:issues).push(message);
    }
    const outcome=response.status===400&&causes.length>0&&causes.every(c=>c?.type==='warning')&&warnings.length>0?'warnings_only':'rejected';
    if(!issues.length&&outcome!=='warnings_only')issues.push('O Mercado Livre não confirmou a validação (HTTP '+response.status+').'+(typeof data.error==='string'?' '+data.error.slice(0,120):''));
    let shippingDiagnostic;
    if(causes.some(c=>typeof c?.code==='string'&&(c.code.startsWith('shipping.')||c.code.startsWith('item.shipping.')))){
     const preferences=async path=>{try{return {data:shippingSummary(await get(path))};}catch(error){return {error:error instanceof UserError?error.message:'Consulta indisponível.'};}};
     const [seller,categoryPreferences]=await Promise.all([preferences('/users/'+encodeURIComponent(String(profile.id))+'/shipping_preferences'),preferences('/categories/'+draft.categoryId+'/shipping_preferences')]);
     shippingDiagnostic={sent:{category_id:prepared.payload.category_id,price:prepared.payload.price,currency_id:prepared.payload.currency_id,shipping:prepared.payload.shipping||null},seller,category:categoryPreferences,causes:causes.slice(0,60).map(c=>({code:String(c?.code||'').slice(0,200),type:String(c?.type||'não informado').slice(0,50)}))};
    }
    return {ok:false,outcome,stage:'remote',issues,warnings,httpStatus:response.status,...shippingDiagnostic?{shippingDiagnostic}:{},checkedAt:new Date(now()).toISOString()};
   }
   const messages={401:'Reconecte sua conta para validar.',403:'O Mercado Livre negou a validação. Confira a permissão de publicação com leitura e escrita.',429:'Limite de consultas atingido. Aguarde antes de validar novamente.'};
   throw new UserError(messages[response.status]||'Não foi possível confirmar a validação. Seu rascunho permanece salvo.',response.status===403?403:502);
  },
  async begin(sessionId){const state=(requireTestUser?'test.':'')+random(),verifier=random();await store.putFlow(hash(state),sessionId,crypto.seal(verifier,'pkce'));const url=new URL('https://auth.mercadolivre.com.br/authorization');for(const [k,v] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirectUri,state,code_challenge:challenge(verifier),code_challenge_method:'S256'}))url.searchParams.set(k,v);return url.href;},
  async complete({state,code,denied,sessionId}){
   if(!state||state.length>200||state.startsWith('test.')!==requireTestUser)throw new UserError('Autorização inválida ou expirada. Inicie a conexão novamente.');
   const saved=await store.takeFlow(hash(state),sessionId);
   if(!saved)throw new UserError('Autorização inválida, expirada ou já utilizada. Inicie a conexão novamente.');
   if(denied)throw new UserError('A autorização foi cancelada no Mercado Livre.');
   if(!code||code.length>4096)throw new UserError('O Mercado Livre não retornou um código válido.');
   const verifier=crypto.open(saved,'pkce');
   await store.withConnection(async db=>{
    const data=await call('/oauth/token',{form:{grant_type:'authorization_code',client_id:clientId,client_secret:clientSecret,code,redirect_uri:redirectUri,code_verifier:verifier}});
    if(requireTestUser){
     const profile=await call('/users/me',{token:data.access_token});const expected=await store.expectedSeller();
     if(!expected||String(profile.id)!==String(expected)||String(data.user_id)!==String(expected)||!profile.tags?.includes('test_user')||profile.site_id!=='MLB')throw new UserError('Conecte a conta de teste cadastrada, não a conta da loja.',403);
    }
    const row=normalize(data),old=await db.get();
    if(old&&String(old.user_id)!==row.user_id)throw new UserError('Este aplicativo já está vinculado a outro vendedor. Use a mesma conta para reconectar.',403);
    await db.save(row);
   });
  },
  async inspect(itemId){
   if(!/^MLB[0-9]{6,20}$/.test(itemId))throw new UserError('Informe um código de anúncio brasileiro válido, como MLB4155100949.');
   const profile=await get('/users/me');
   const item=await get('/items/'+itemId);
   if(String(item.seller_id)!==String(profile.id))throw new UserError('Esse anúncio não pertence à conta conectada.',403);
   const optional=async path=>{try{return {data:await get(path)};}catch(error){return {error:error instanceof UserError?error.message:'Consulta indisponível.'};}};
   const description=await optional('/items/'+itemId+'/description');
   const compatibility=await optional('/items/'+itemId+'/compatibilities?extended=true');
   return {profile,item,description,compatibility,checkedAt:new Date(now()).toISOString()};
  }
 };
}
