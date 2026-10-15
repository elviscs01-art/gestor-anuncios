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
export function createApp({settings,store=new SetupSessions(),meli,now=Date.now}){
 const missing=[!settings.databaseUrl&&'DATABASE_URL',!settings.key&&'TOKEN_ENCRYPTION_KEY',!settings.clientId&&'MELI_CLIENT_ID',!settings.clientSecret&&'MELI_CLIENT_SECRET'].filter(Boolean);
 const cookieName=settings.production?'__Host-gestor':'gestor';
 const stamp=sessionStamp(settings.password,settings.key||processPepper);
 const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${settings.production?'; Secure':''}`;
 const handler=async(req,res)=>{
  const nonce=random();
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self' https://auth.mercadolivre.com.br https://www.mercadolivre.com.br; frame-ancestors 'none'; base-uri 'none'");
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
    let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>8192)throw new UserError('Formulário muito grande.',413);}
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
    if(missing.length||!meli)return redirect('/?notice=oauth_failed');
    try{await meli.complete({sessionId,state:url.searchParams.get('state'),code:url.searchParams.get('code'),denied:url.searchParams.has('error')});}
    catch(error){console.error(`oauth_failed:${error instanceof UserError?error.status:'internal'}`);return redirect('/?notice=oauth_failed');}
    return redirect('/?notice=connected');
   }
   if(path==='/anuncio'&&req.method==='POST'){
    if(!meli||missing.length)throw new UserError('Configure e conecte a conta primeiro.',409);
    return send(200,view.report(await meli.inspect((form.get('item')||'').trim().toUpperCase()),session));
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
  const {server}=createApp({settings,store,meli});
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Gestor 0.2 iniciado.'));
  process.on('SIGTERM',()=>{server.close(async()=>{await store.close?.();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();});
 }catch{console.error('Falha ao iniciar. Confira as variáveis de configuração e a conexão com o banco. Nenhum segredo foi registrado.');process.exitCode=1;}
}
