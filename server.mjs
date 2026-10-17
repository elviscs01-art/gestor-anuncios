import {diagnosticContext,recordFailure,resolveFailure,errorInfo,diagnosticPrompt,observe} from './diagnostics.mjs';
import * as qualityView from './quality-views.mjs';
import {createReplacement} from './replacement.mjs';
import * as replacementView from './replacement-views.mjs';
import {kgToGrams} from './replication-fields.mjs';
import {createReplication} from './replication.mjs';
import * as replicationView from './replication-views.mjs';
import {createOverview,range} from './overview.mjs';
import * as overviewView from './overview-views.mjs';
import {readFileSync} from 'node:fs';
const replacementScript=readFileSync(new URL('./replacement-client.js',import.meta.url),'utf8');
const qualityScript=readFileSync(new URL('./quality-client.js',import.meta.url),'utf8');
const diagnosticScript=readFileSync(new URL('./diagnostics-client.js',import.meta.url),'utf8');
const replicationScript=readFileSync(new URL('./replication-client.js',import.meta.url),'utf8');
const overviewScript=readFileSync(new URL('./overview-client.js',import.meta.url),'utf8');
const metricsScript=readFileSync(new URL('./metrics-client.js',import.meta.url),'utf8');
import {createMetrics} from './metrics.mjs';
import * as metricsView from './metrics-views.mjs';
import {createPublications} from './publications.mjs';
import * as publicationView from './publication-views.mjs';
import {createLab} from './test-lab.mjs';
import * as testView from './test-views.mjs';
import {applyForm} from './drafts.mjs';
import * as draftsView from './draft-views.mjs';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {hash,equal,random,vault,UserError,sessionStamp} from './security.mjs';
import {SetupSessions,postgres} from './store.mjs';
import {createMeli} from './meli.mjs';
import * as view from './views.mjs';
const processPepper=random();
export function config(env){
 const production=env.NODE_ENV==='production';
 const base=new URL(env.APP_BASE_URL||env.RENDER_EXTERNAL_URL||(!production?'http://localhost:3000':''));
 if(base.pathname!=='/'||base.search||base.hash||base.username||base.password||production&&base.protocol!=='https:')throw new Error('APP_BASE_URL deve ser uma origem HTTPS, sem caminho ou parâmetros.');
 if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<20)throw new Error('Configure ADMIN_PASSWORD com pelo menos 20 caracteres.');
 if(env.TOKEN_ENCRYPTION_KEY&&env.TOKEN_ENCRYPTION_KEY===env.ADMIN_PASSWORD)throw new Error('Use chaves diferentes para login e criptografia.');
 return {production,baseUrl:base.origin,password:env.ADMIN_PASSWORD,databaseUrl:env.DATABASE_URL||'',key:env.TOKEN_ENCRYPTION_KEY||'',clientId:env.MELI_CLIENT_ID||'',clientSecret:env.MELI_CLIENT_SECRET||'',expectedSeller:env.MELI_SELLER_ID||''};
}
export function createApp({settings,store=new SetupSessions(),meli,testMeli,lab,publications,metrics,dashboard,catalog,replication,replacement,quality,now=Date.now}){
 meli=observe(meli,'meli');replication=observe(replication,'replication');replacement=observe(replacement,'replacement');publications=observe(publications,'publications');lab=observe(lab,'testLab');
 const missing=[!settings.databaseUrl&&'DATABASE_URL',!settings.key&&'TOKEN_ENCRYPTION_KEY',!settings.clientId&&'MELI_CLIENT_ID',!settings.clientSecret&&'MELI_CLIENT_SECRET'].filter(Boolean);
 const cookieName=settings.production?'__Host-gestor':'gestor';
 const stamp=sessionStamp(settings.password,settings.key||processPepper);
 const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${settings.production?'; Secure':''}`;
 const rawHandler=async(req,res)=>{
  const nonce=random();
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src https://*.mlstatic.com; form-action 'self' https://auth.mercadolivre.com.br https://www.mercadolivre.com.br; frame-ancestors 'none'; base-uri 'none'");
  if(settings.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(status,body,type='text/html; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  const redirect=path=>{res.writeHead(303,{Location:path});res.end();};
  const jsonMetrics=(req.headers.accept||'').includes('application/json')&&['/metricas','/painel','/anuncios','/publicacoes','/substituicoes','/sem-replicacao','/qualidade','/configuracoes/erros'].some(p=>req.url.startsWith(p));
  let session=null;
  try{
   const url=new URL(req.url,settings.baseUrl),path=url.pathname;
   if(req.method==='GET'&&path==='/health'){try{await store.ping();return send(200,'{"status":"ok"}','application/json');}catch{return send(503,'{"status":"unavailable"}','application/json');}}
   if(req.method==='GET'&&path==='/style.css')return send(200,view.css,'text/css; charset=utf-8');
   if(req.method==='GET'&&path==='/replacement.js')return send(200,replacementScript,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&path==='/diagnostics.js')return send(200,diagnosticScript,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&path==='/quality.js')return send(200,qualityScript,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&path==='/replication.js')return send(200,replicationScript,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&path==='/overview.js')return send(200,overviewScript,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&path==='/metrics.js')return send(200,metricsScript,'text/javascript; charset=utf-8');
   if(!['GET','POST'].includes(req.method))return send(405,'Método não permitido.');
   if(req.method==='POST'&&req.headers.origin!==settings.baseUrl)throw new UserError('Solicitação de outra origem bloqueada.',403);
   const rawCookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
   const sessionId=hash(rawCookie);
   if(rawCookie&&rawCookie.length<200)session=await store.getSession(sessionId);
   if(session&&(!equal(session.stamp,stamp)||Number(session.expires)<=now())){await store.deleteSession(sessionId);session=null;}
   if(path==='/login'&&req.method==='GET')return session?redirect('/'):send(200,view.login());
   let form;
   if(req.method==='POST'){
    if(!(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw new UserError('Formato de formulário inválido.',415);
    let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>((path.startsWith('/rascunhos/')||path.startsWith('/publicacoes/lote/'))?262144:8192))throw new UserError('Formulário muito grande.',413);}
    form=new URLSearchParams(body);
   }
   if(path==='/login'&&req.method==='POST'){
    if(!await store.loginAllowed()){res.setHeader('Retry-After','60');return send(429,view.login('Muitas tentativas. Aguarde um minuto.'));}
    if(!equal(form.get('password')||'',settings.password))return send(401,view.login('Senha incorreta. Confira o valor cadastrado no Render.'));
    if(rawCookie)await store.deleteSession(sessionId);
    const token=random();await store.putSession(hash(token),{csrf:random(),stamp,expires:now()+8*3600000});
    res.setHeader('Set-Cookie',cookie(token,8*3600));return redirect('/');
   }
   if(!session){if(jsonMetrics)return send(401,JSON.stringify({error:'Sessão expirada. Entre novamente no aplicativo.'}),'application/json');return redirect('/login');}
   if(req.method==='POST'&&!equal(form.get('csrf')||'',session.csrf))throw new UserError('Formulário expirado. Recarregue a página e tente novamente.',403);
   session={...session,page:path};
   const context=diagnosticContext.getStore();if(context){context.authorized=true;context.owner=String((await store.summary())?.user_id||'app');res.on?.('finish',()=>{if(res.statusCode<400)void resolveFailure('request:'+req.method+':'+path);});}
   if(path==='/configuracoes/erros'&&req.method==='GET'){const rows=await store.diagnostics?.list(context?.owner||'app')||[];return send(200,JSON.stringify({text:diagnosticPrompt(rows)}),'application/json');}
   if(path==='/logout'&&req.method==='POST'){await store.deleteSession(sessionId);res.setHeader('Set-Cookie',cookie('',0));return redirect('/login');}
   if(path==='/configuracoes'&&req.method==='GET'){
    const notices={connected:'Autorização salva. Confira o vendedor e consulte o anúncio de referência.',oauth_failed:'Não foi possível confirmar a autorização. Confira a conta principal, as permissões, o PKCE e o endereço de retorno; depois tente conectar novamente.'};
    return send(200,view.home({session,missing,connection:await store.summary(),baseUrl:settings.baseUrl,notice:notices[url.searchParams.get('notice')]||''}));
   }
   if(path==='/'&&req.method==='GET'){
    const connection=await store.summary(),owner=String(connection?.user_id||''),ready=!missing.length&&!!dashboard&&connection?.status==='ready';
    const notice=url.searchParams.get('notice')==='connected'?'Conta conectada com sucesso.':url.searchParams.get('notice')==='oauth_failed'?'Não foi possível conectar. Confira a conexão em Configurações.':'';
    return send(200,overviewView.page({session,ready,notice,params:url.searchParams,job:ready?await dashboard.read(owner):null,catalog:ready&&catalog?await catalog.read(owner):null}));
   }
   if(path==='/anuncios'||path.startsWith('/anuncios/')||path.startsWith('/painel/')){
    const kind=path.startsWith('/anuncios')?'catalog':'dashboard',service=kind==='catalog'?catalog:dashboard;
    const connection=await store.summary();if(missing.length||!service||!connection?.user_id)throw new UserError('Conecte a conta oficial em Configurações.',409);
    const owner=String(connection.user_id);
    if(path==='/anuncios'&&req.method==='GET')return send(200,overviewView.page({session,job:await service.read(owner),params:url.searchParams,kind}));
    if(path==='/painel/vendas'&&req.method==='GET'){
     await meli.metricsProfile(owner);const at=now(),page=await meli.dashboardOrders(owner,{...range(at),paidOnly:true});
     return send(200,JSON.stringify({html:overviewView.recent(page.rows,new Date(at).toISOString())}),'application/json');
    }
    const action=path.split('/').pop();
    if(req.method==='POST'&&action==='iniciar')await service.start(owner);
    else if(req.method==='POST'&&action==='avancar')await service.advance(owner);
    else if(!(req.method==='GET'&&action==='dados'))throw new UserError('Página não encontrada.',404);
    return send(200,JSON.stringify(overviewView.state(await service.read(owner),url.searchParams,kind==='dashboard'&&catalog?await catalog.read(owner):null,kind)),'application/json');
   }
   if(path==='/oauth/mercadolivre/start'&&req.method==='POST'){
    if(missing.length||!meli)throw new UserError('Conclua as configurações indicadas no painel antes de conectar.',409);
    return redirect(await meli.begin(sessionId));
   }
   if(path==='/oauth/mercadolivre/callback'&&req.method==='GET'){
    const isTest=(url.searchParams.get('state')||'').startsWith('test.');
    const service=isTest?testMeli:meli,back=isTest?'/testes':'/';
    if(missing.length||!service)return redirect(back+'?notice='+(isTest?'auth_failed':'oauth_failed'));
    try{await service.complete({sessionId,state:url.searchParams.get('state'),code:url.searchParams.get('code'),denied:url.searchParams.has('error')});}
    catch(error){console.error('oauth_failed:'+(error instanceof UserError?error.status:'internal'));return redirect(back+'?notice='+(isTest?'auth_failed':'oauth_failed'));}
    return redirect(back+'?notice=connected');
   }
   if(path==='/metricas'||path.startsWith('/metricas/')){
    if(missing.length||!metrics)throw new UserError('Configure a conexão principal primeiro.',409);
    const connection=await store.summary();if(!connection?.user_id)throw new UserError('Conecte a conta oficial.',409);
    const owner=String(connection.user_id);
    const jsonState=async()=>send(200,JSON.stringify(metricsView.state(await metrics.read(owner),session,url.searchParams)),'application/json; charset=utf-8');
    if(path==='/metricas'&&req.method==='GET')return send(200,metricsView.dashboard(await metrics.read(owner),session,url.searchParams));
    if(path==='/metricas/dados'&&req.method==='GET')return jsonState();
    if(req.method==='POST'){
     if(path==='/metricas/iniciar')await metrics.start(owner);
     else if(path==='/metricas/avancar')await metrics.advance(owner);
     else if(path==='/metricas/pausar')await metrics.pause(owner);
     else if(path==='/metricas/retomar')await metrics.resume(owner);
     else if(path==='/metricas/descartar')await store.metrics.discard(owner);
     else throw new UserError('Página não encontrada.',404);
     if(jsonMetrics)return jsonState();
     return redirect('/metricas?auto=1');
    }
   }
   if(path==='/qualidade'||path.startsWith('/qualidade/')){
    const connection=await store.summary();if(missing.length||!quality||!connection?.user_id)throw new UserError('Conecte a conta oficial em Configurações.',409);const owner=String(connection.user_id);
    if(path==='/qualidade'&&req.method==='GET')return send(200,qualityView.page(await quality.read(owner),session,url.searchParams));
    if(path==='/qualidade/iniciar'&&req.method==='POST')await quality.start(owner);
    else if(path==='/qualidade/avancar'&&req.method==='POST')await quality.advance(owner);
    else if(!(path==='/qualidade/dados'&&req.method==='GET'))throw new UserError('Página não encontrada.',404);
    return send(200,JSON.stringify(qualityView.state(await quality.read(owner),url.searchParams)),'application/json');
   }
   if(path==='/sem-replicacao'||path.startsWith('/sem-replicacao/')){
    const connection=await store.summary();if(missing.length||!catalog||!replication||!connection?.user_id)throw new UserError('Conecte a conta oficial em Configurações.',409);const owner=String(connection.user_id);
    if(path==='/sem-replicacao'&&req.method==='GET')return send(200,replicationView.list(await catalog.read(owner),await replication.list(owner),session,url.searchParams,true));
    if(path==='/sem-replicacao/atualizar'&&req.method==='POST')await catalog.start(owner);
    else if(path==='/sem-replicacao/coletar'&&req.method==='POST')await catalog.advance(owner);
    else if(!(path==='/sem-replicacao/lista'&&req.method==='GET'))throw new UserError('Página não encontrada.',404);
    return send(200,JSON.stringify(replicationView.listState(await catalog.read(owner),url.searchParams,true)),'application/json');
   }
   if(path==='/substituicoes'||path.startsWith('/substituicoes/')){
    const connection=await store.summary();if(missing.length||!replacement||!catalog||!connection?.user_id)throw new UserError('Conecte a conta oficial em Configurações.',409);const owner=String(connection.user_id);
    if(path==='/substituicoes'&&req.method==='GET')return send(200,replacementView.list(await catalog.read(owner),await replacement.list(owner),session,url.searchParams));
    if(['/substituicoes/lista','/substituicoes/atualizar','/substituicoes/coletar'].includes(path)){
     if(path==='/substituicoes/atualizar'&&req.method==='POST')await catalog.start(owner);
     else if(path==='/substituicoes/coletar'&&req.method==='POST')await catalog.advance(owner);
     else if(!(path==='/substituicoes/lista'&&req.method==='GET'))throw new UserError('Método não permitido.',405);
     return send(200,JSON.stringify(replacementView.listState(await catalog.read(owner),await replacement.list(owner),session,url.searchParams)),'application/json');
    }
    if(path==='/substituicoes/iniciar'&&req.method==='POST'){const row=await replacement.begin(owner,form.get('item'));return redirect('/substituicoes/resultado/'+row.id);}
    const match=path.match(/^[/]substituicoes[/]resultado[/]([A-Za-z0-9_-]{43})(?:[/](avancar|dados|retomar))?$/);
    if(match){let row=await replacement.read(match[1],owner);if(match[2]==='retomar'&&req.method==='POST'){await replacement.retry(match[1],owner);return redirect('/substituicoes/resultado/'+match[1]);}if(!match[2]&&req.method==='GET')return send(200,replacementView.result(row,session));if(match[2]==='avancar'&&req.method==='POST')row=await replacement.advance(match[1],owner);else if(!(match[2]==='dados'&&req.method==='GET'))throw new UserError('Método não permitido.',405);return send(200,JSON.stringify(replacementView.state(row)),'application/json');}
    throw new UserError('Página não encontrada.',404);
   }
   if(path==='/publicacoes'||path.startsWith('/publicacoes/')){
    if(missing.length||!publications)throw new UserError('Configure a conexão principal primeiro.',409);
    const connection=await store.summary();if(!connection?.user_id)throw new UserError('Conecte a conta oficial.',409);
    const owner=String(connection.user_id);
    if(path==='/publicacoes'&&req.method==='GET')return send(200,replicationView.list(await catalog.read(owner),await replication.list(owner),session,url.searchParams));
    if(['/publicacoes/lista','/publicacoes/atualizar','/publicacoes/coletar'].includes(path)){
     if(path==='/publicacoes/atualizar'&&req.method==='POST')await catalog.start(owner);
     else if(path==='/publicacoes/coletar'&&req.method==='POST')await catalog.advance(owner);
     else if(!(path==='/publicacoes/lista'&&req.method==='GET'))throw new UserError('Método não permitido.',405);
     return send(200,JSON.stringify(replicationView.listState(await catalog.read(owner),url.searchParams)),'application/json');
    }
    if(path==='/publicacoes/replicar'&&req.method==='POST'){
     const id=form.get('requestId');if(!/^[A-Za-z0-9_-]{43}$/.test(id||''))throw new UserError('Solicitação inválida. Reabra a lista.');
     const row=await replication.begin(owner,form.get('item'),Number(form.get('count')),id);return redirect('/publicacoes/lote/'+row.id);
    }
    const batchMatch=path.match(/^[/]publicacoes[/]lote[/]([A-Za-z0-9_-]{43})(?:[/](publicar|avancar|dados))?$/);
    if(batchMatch){const id=batchMatch[1],action=batchMatch[2];let row=await replication.read(id,owner);
     if(!action&&req.method==='GET')return send(200,row.status==='editing'?replicationView.edit(row,session):replicationView.result(row,session));
     if(action==='publicar'&&req.method==='POST'){
      const copies=row.data.copies.map((c,i)=>({title:String(form.get('title'+i)||''),type:String(form.get('type'+i)||''),price:String(form.get('price'+i)??'')}));
      const result=await replication.submit(id,owner,copies,form.get('finalState'),Object.fromEntries(['height','width','length','weight'].map(k=>[k,k==='weight'&&form.get('package_weight_unit')==='kg'?kgToGrams(form.get('package_weight')):String(form.get('package_'+k)||'')])));
      if(Object.keys(result.errors).length){if(form.get('package_weight_unit')==='kg'){result.row.data.packageWeightKg=String(form.get('package_weight')||'');if(result.errors.package_weight)result.errors.package_weight='Informe o peso em kg, com até três casas decimais.';}return send(400,replicationView.edit(result.row,session,result.errors));}
      return redirect('/publicacoes/lote/'+id);
     }
     if(action==='avancar'&&req.method==='POST')row=await replication.advance(id,owner);
     else if(!(action==='dados'&&req.method==='GET'))throw new UserError('Método não permitido.',405);
     return send(200,JSON.stringify(replicationView.batchState(row)),'application/json');
    }
    if(path==='/publicacoes/historico'&&req.method==='GET')return send(200,publicationView.list(await publications.list(owner),session));
    if(path==='/publicacoes/preparar'&&req.method==='POST'){
     const id=form.get('draftId')||'',revision=Number(form.get('revision'));
     if(!/^[A-Za-z0-9_-]{43}$/.test(id)||!Number.isSafeInteger(revision)||revision<1)throw new UserError('Rascunho inválido.');
     const row=await publications.prepare(owner,id,revision);return redirect('/publicacoes/resultado/'+row.id);
    }
    const match=path.match(/^[/]publicacoes[/]resultado[/]([A-Za-z0-9_-]{43})$/);
    if(match&&req.method==='GET')return send(200,publicationView.attempt(await publications.result(match[1],owner),session));
    if(['/publicacoes/publicar','/publicacoes/pausar'].includes(path)&&req.method==='POST'){
     const id=form.get('attemptId')||'';
     if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw new UserError('Publicação inválida.');
     if(path==='/publicacoes/publicar'){
      if(form.get('confirm')!=='official')throw new UserError('Revise e confirme a publicação na conta oficial.');
      await publications.run(id,owner);
     }else await publications.pause(id,owner);
     return redirect('/publicacoes/resultado/'+id);
    }
   }
   if(path==='/testes'||path.startsWith('/testes/')){
    if(missing.length||!lab||!testMeli)throw new UserError('Conclua a configuração do aplicativo primeiro.',409);
    const connection=await store.summary();
    if(!connection?.user_id)throw new UserError('Conecte a conta principal primeiro.',409);
    const owner=String(connection.user_id);
    if(path==='/testes'&&req.method==='GET')return send(200,testView.home(await lab.home(owner),session,url.searchParams.get('notice')));
    if(path==='/testes/conta'&&req.method==='POST'){await lab.createAccount();return redirect('/testes');}
    if(path==='/testes/conectar'&&req.method==='POST'){
     if(!(await store.testing.expectedSeller()))throw new UserError('Gere a conta de teste primeiro.',409);
     return redirect(await testMeli.begin(sessionId));
    }
    if(path==='/testes/preparar'&&req.method==='POST'){
     const id=form.get('draftId')||'',revision=Number(form.get('revision'));
     if(!/^[A-Za-z0-9_-]{43}$/.test(id)||!Number.isSafeInteger(revision)||revision<1)throw new UserError('Rascunho inválido.');
     const row=await lab.prepare(owner,id,revision);return redirect('/testes/resultado/'+row.id);
    }
    const route=path.match(/^[/]testes[/]resultado[/]([A-Za-z0-9_-]{43})$/);
    if(route&&req.method==='GET')return send(200,testView.attempt(await lab.result(route[1],owner),session));
    if(['/testes/publicar','/testes/pausar'].includes(path)&&req.method==='POST'){
     const id=form.get('attemptId')||'';
     if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw new UserError('Teste inválido.');
     if(path==='/testes/publicar'&&form.get('confirm')!=='test')throw new UserError('Confirme a criação na conta de teste.');
     if(path==='/testes/publicar')await lab.run(id,owner);else await lab.pause(id,owner);
     return redirect('/testes/resultado/'+id);
    }
   }
   if(path==='/anuncio'&&req.method==='POST'){
    if(!meli||missing.length)throw new UserError('Configure e conecte a conta primeiro.',409);
    return send(200,view.report(await meli.inspect((form.get('item')||'').trim().toUpperCase()),session));
   }
   if(path==='/rascunhos'||path.startsWith('/rascunhos/')){
    if(missing.length||!meli)throw new UserError('Configure e conecte a conta antes de preparar rascunhos.',409);
    const connection=await store.summary();
    if(!connection?.user_id)throw new UserError('Conecte sua conta do Mercado Livre primeiro.',409);
    const seller=String(connection.user_id);
    if(path==='/rascunhos'&&req.method==='GET')return send(200,draftsView.list(await store.listDrafts(seller),session));
    if(path==='/rascunhos/criar'&&req.method==='POST'){
     const data=await meli.draftSource((form.get('item')||'').trim().toUpperCase());
     if(data.sellerId!==seller)throw new UserError('A conta conectada mudou. Atualize a página.',409);
     const id=random();await store.createDraft(id,seller,data);return redirect('/rascunhos/'+id);
    }
    const route=path.match(/^[/]rascunhos[/]([A-Za-z0-9_-]{43})$/);
    if(route&&req.method==='GET'){
     const row=await store.getDraft(route[1],seller);if(!row)throw new UserError('Rascunho não encontrado.',404);
     return send(200,draftsView.editor(row,session,url.searchParams.get('saved')==='1'?'Rascunho salvo.':''));
    }
    if(['/rascunhos/salvar','/rascunhos/validar'].includes(path)&&req.method==='POST'){
     const id=form.get('draftId')||'',revision=Number(form.get('revision'));
     if(!/^[A-Za-z0-9_-]{43}$/.test(id)||!Number.isSafeInteger(revision)||revision<1)throw new UserError('Identificação de rascunho inválida.');
     const old=await store.getDraft(id,seller);if(!old)throw new UserError('Rascunho não encontrado.',404);
     if(old.revision!==revision)throw new UserError('Este rascunho foi alterado em outra aba. Reabra a versão salva antes de continuar.',409);
     const row=await store.updateDraft(id,seller,revision,applyForm(old.data,form));
     if(!row)throw new UserError('O rascunho mudou em outra aba. Reabra a versão salva.',409);
     if(path==='/rascunhos/salvar')return redirect('/rascunhos/'+id+'?saved=1');
     let validation;
     try{validation=await meli.validateDraft(row.data);}
     catch(error){if(!(error instanceof UserError))throw error;return send(error.status,draftsView.editor(row,session,'Rascunho salvo. '+error.message));}
     const checked=await store.setDraftValidation(id,seller,row.revision,validation);
     if(!checked)throw new UserError('O rascunho mudou durante a validação. Abra e valide a versão mais recente.',409);
     return redirect('/rascunhos/'+id);
    }
   }
   return send(404,view.errorPage('Página não encontrada.',session));
  }catch(error){
   await recordFailure('request:'+req.method+':'+new URL(req.url,settings.baseUrl).pathname,{operation:'request',...errorInfo(error)});
   const known=error instanceof UserError;
   if(!known)console.error('request_failed:'+nonce); // No URLs, tokens, password, request bodies or database error text.
   if(!res.headersSent&&jsonMetrics)return send(known?error.status:503,JSON.stringify({error:known?error.message:'Serviço temporariamente indisponível. Tente retomar o diagnóstico.'}),'application/json');
   if(!res.headersSent)send(known?error.status:503,view.errorPage(known?error.message:'Serviço temporariamente indisponível. Confira a disponibilidade do banco e tente novamente.',session));else res.end();
  }
 };
 const handler=(req,res)=>diagnosticContext.run({reporter:store.diagnostics,route:new URL(req.url,settings.baseUrl).pathname,method:req.method,authorized:false,secrets:[settings.password,settings.key,settings.clientSecret,settings.databaseUrl]},()=>rawHandler(req,res));
 const server=http.createServer(handler);server.requestTimeout=20000;server.headersTimeout=10000;
 return {server,handler};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const settings=config(process.env);
  const crypto=settings.key?vault(settings.key):null;
  const store=settings.databaseUrl?await postgres(settings.databaseUrl):new SetupSessions();
  const meli=settings.databaseUrl&&crypto&&settings.clientId&&settings.clientSecret?observe(createMeli({store,crypto,...settings}),'meli'):null;
  const testMeli=meli?createMeli({...settings,store:store.testing,crypto,expectedSeller:'',requireTestUser:true}):null;
  const lab=meli?createLab({store,live:meli,test:testMeli,crypto}):null;
  const publications=meli?createPublications({store,meli}):null;
  const metrics=meli?createMetrics({db:store.metrics,meli}):null;
  const dashboard=meli?createOverview({db:store.dashboard,meli,kind:'dashboard'}):null;
  const catalog=meli?createOverview({db:store.catalog,meli,kind:'catalog'}):null;
  const replication=meli?createReplication({db:store.replication,meli}):null;
  const replacement=meli?createReplacement({db:store.replacement,meli}):null;
  const quality=meli?createOverview({db:store.quality,meli,kind:'quality'}):null;
  const {server}=createApp({settings,store,meli,testMeli,lab,publications,metrics,dashboard,catalog,replication,replacement,quality});
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Gestor 0.13.0 iniciado.'));
  process.on('SIGTERM',()=>{server.close(async()=>{await store.close?.();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();});
 }catch{console.error('Falha ao iniciar. Confira as variáveis de configuração e a conexão com o banco. Nenhum segredo foi registrado.');process.exitCode=1;}
}
