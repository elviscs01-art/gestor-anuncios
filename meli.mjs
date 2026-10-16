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
export function createMeli({store,crypto,clientId,clientSecret,baseUrl,expectedSeller='',requireTestUser=false,fetcher=fetch,now=Date.now}){
 const redirectUri=baseUrl+'/oauth/mercadolivre/callback';
 async function call(path,{token,form}={}){
  let response;
  try{response=await fetcher(API+path,{method:form?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:form?{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'}:{Authorization:`Bearer ${token}`,Accept:'application/json'},...(form?{body:new URLSearchParams(form)}:{})});}
  catch{throw new UserError('Não foi possível acessar o Mercado Livre. Tente novamente; se ocorreu durante a autorização, inicie uma nova conexão.',502);}
  let data;
  try{data=await response.json();}catch{throw new UserError('O Mercado Livre retornou uma resposta inesperada.',502);}
  if(!response.ok){
   const messages={401:'O acesso não foi autorizado. Reconecte sua conta.',403:'O Mercado Livre negou esta consulta. Confira as permissões do aplicativo e a conta autorizada.',404:'O recurso não foi encontrado no Mercado Livre.',429:'O limite de consultas foi atingido. Aguarde antes de tentar novamente.'};
   const error=new UserError(messages[response.status]||'O Mercado Livre não concluiu a solicitação. Confira a configuração e tente novamente.',response.status>=500?502:response.status);
   error.remoteStatus=response.status;throw error;
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
  const {token}=await officialAccess(expected);
  if(!/^MLB[0-9]+$/.test(itemId))throw new UserError('Código de anúncio inválido.');
  const item=await call('/items/'+itemId,{token});
  if(String(item.seller_id)!==String(expected))throw new UserError('O anúncio não pertence à conta oficial.',403);
  return {token,item};
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
   e.uncertain=response.status>=500;throw e;
  }
  return data;
 }
 return {
  redirectUri,
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
