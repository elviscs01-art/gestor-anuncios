import {UserError,challenge,random,hash} from './security.mjs';
const API='https://api.mercadolibre.com';
export function createMeli({store,crypto,clientId,clientSecret,baseUrl,expectedSeller='',fetcher=fetch,now=Date.now}){
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
 return {
  redirectUri,
  async begin(sessionId){const state=random(),verifier=random();await store.putFlow(hash(state),sessionId,crypto.seal(verifier,'pkce'));const url=new URL('https://auth.mercadolivre.com.br/authorization');for(const [k,v] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirectUri,state,code_challenge:challenge(verifier),code_challenge_method:'S256'}))url.searchParams.set(k,v);return url.href;},
  async complete({state,code,denied,sessionId}){
   if(!state||state.length>200)throw new UserError('Autorização inválida ou expirada. Inicie a conexão novamente.');
   const saved=await store.takeFlow(hash(state),sessionId);
   if(!saved)throw new UserError('Autorização inválida, expirada ou já utilizada. Inicie a conexão novamente.');
   if(denied)throw new UserError('A autorização foi cancelada no Mercado Livre.');
   if(!code||code.length>4096)throw new UserError('O Mercado Livre não retornou um código válido.');
   const verifier=crypto.open(saved,'pkce');
   await store.withConnection(async db=>{
    const data=await call('/oauth/token',{form:{grant_type:'authorization_code',client_id:clientId,client_secret:clientSecret,code,redirect_uri:redirectUri,code_verifier:verifier}});
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
