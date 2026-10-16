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
export function createApp({settings,store=new SetupSessions(),meli,testMeli,lab,now=Date.now}){
 const missing=[!settings.databaseUrl&&'DATABASE_URL',!settings.key&&'TOKEN_ENCRYPTION_KEY',!settings.clientId&&'MELI_CLIENT_ID',!settings.clientSecret&&'MELI_CLIENT_SECRET'].filter(Boolean);
 const cookieName=settings.production?'__Host-gestor':'gestor';
 const stamp=sessionStamp(settings.password,settings.key||processPepper);
 const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${settings.production?'; Secure':''}`;
 const handler=async(req,res)=>{
  const nonce=random();
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self' 'unsafe-inline'; img-src https://*.mlstatic.com; form-action 'self' https://auth.mercadolivre.com.br https://www.mercadolivre.com.br; frame-ancestors 'none'; base-uri 'none'");
  if(settings.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(status,body,type='text/html; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  const redirect=path=>{res.writeHead(303,{Location:path});res.end();};
  let session=null;
  try{
   const url=new URL(req.url,settings.baseUrl),path=url.pathname;
   if(req.method==='GET'&&path==='/health'){try{await store.ping();return send(200,'{"status":"ok"}','application/json');}catch{return send(503,'{"status":"unavailable"}','application/json');}}
   if(req.method==='GET'&&path==='/style.css')return send(200,view.css,'text/css; charset=utf-8');
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
    let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>(path.startsWith('/rascunhos/')?262144:8192))throw new UserError('Formulário muito grande.',413);}
    form=new URLSearchParams(body);
   }
   if(path==='/login'&&req.method==='POST'){
    if(!await store.loginAllowed()){res.setHeader('Retry-After','60');return send(429,view.login('Muitas tentativas. Aguarde um minuto.'));}
    if(!equal(form.get('password')||'',settings.password))return send(401,view.login('Senha incorreta. Confira o valor cadastrado no Render.'));
    if(rawCookie)await store.deleteSession(sessionId);
    const token=random();await store.putSession(hash(token),{csrf:random(),stamp,expires:now()+8*3600000});
    res.setHeader('Set-Cookie',cookie(token,8*3600));return redirect('/');
   }
   if(!session)return redirect('/login');
   if(req.method==='POST'&&!equal(form.get('csrf')||'',session.csrf))throw new UserError('Formulário expirado. Recarregue a página e tente novamente.',403);
   if(path==='/logout'&&req.method==='POST'){await store.deleteSession(sessionId);res.setHeader('Set-Cookie',cookie('',0));return redirect('/login');}
   if(path==='/'&&req.method==='GET'){
    const notices={connected:'Autorização salva. Confira o vendedor e consulte o anúncio de referência.',oauth_failed:'Não foi possível confirmar a autorização. Confira a conta principal, as permissões, o PKCE e o endereço de retorno; depois tente conectar novamente.'};
    return send(200,view.home({session,missing,connection:await store.summary(),baseUrl:settings.baseUrl,notice:notices[url.searchParams.get('notice')]||''}));
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
   const known=error instanceof UserError;
   if(!known)console.error('request_failed:'+nonce); // No URLs, tokens, password, request bodies or database error text.
   if(!res.headersSent)send(known?error.status:503,view.errorPage(known?error.message:'Serviço temporariamente indisponível. Confira a disponibilidade do banco e tente novamente.',session));else res.end();
  }
 };
 const server=http.createServer(handler);server.requestTimeout=20000;server.headersTimeout=10000;
 return {server,handler};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const settings=config(process.env);
  const crypto=settings.key?vault(settings.key):null;
  const store=settings.databaseUrl?await postgres(settings.databaseUrl):new SetupSessions();
  const meli=settings.databaseUrl&&crypto&&settings.clientId&&settings.clientSecret?createMeli({store,crypto,...settings}):null;
  const testMeli=meli?createMeli({...settings,store:store.testing,crypto,expectedSeller:'',requireTestUser:true}):null;
  const lab=meli?createLab({store,live:meli,test:testMeli,crypto}):null;
  const {server}=createApp({settings,store,meli,testMeli,lab});
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Gestor 0.4.0 iniciado.'));
  process.on('SIGTERM',()=>{server.close(async()=>{await store.close?.();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();});
 }catch{console.error('Falha ao iniciar. Confira as variáveis de configuração e a conexão com o banco. Nenhum segredo foi registrado.');process.exitCode=1;}
}
