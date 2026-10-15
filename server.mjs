import http from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash = s => createHash('sha256').update(s).digest();
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gestor de anúncios</title><style>body{margin:0;background:#edf2f5;color:#183440;font:17px system-ui,sans-serif}header{padding:24px;background:#183440;color:white}main{max-width:780px;margin:40px auto;padding:0 24px}article{background:white;border:1px solid #d6e1e6;border-radius:16px;padding:30px;margin-bottom:20px}h1{font-size:32px;letter-spacing:-1px}p,li{line-height:1.7}.badge{background:#fff0cc;color:#705014;border-radius:20px;padding:8px 14px;display:inline-block}small{color:#526976}code{overflow-wrap:anywhere}</style><header>Gestor de anúncios · Densul</header><main><article><small>PREPARAÇÃO DA INTEGRAÇÃO</small><h1>Vamos conectar sua loja</h1><span class="badge">Mercado Livre ainda não conectado</span><p>Esta primeira versão confirma o acesso privado ao aplicativo. Nenhum anúncio foi consultado ou alterado.</p><h2>Próximas etapas</h2><ol><li>Confirmar o endereço público do aplicativo.</li><li>Configurar a autorização do Mercado Livre e o armazenamento seguro.</li><li>Consultar o anúncio de referência e suas compatibilidades.</li></ol></article><article><h2>Nosso primeiro produto</h2><p>Evaporador de ar-condicionado automotivo</p><p>Anúncio: <code>MLB4155100949</code><br>Produto: <code>MLBU3354004962</code></p><small>Identificadores extraídos do link fornecido. Os dados serão confirmados pela API.</small></article></main></html>`;
export function createApp({password, production=false, now=Date.now}={}) {
 if (!password || password.length<20) throw new Error('Configure ADMIN_PASSWORD com pelo menos 20 caracteres.');
 const expected=hash('admin:'+password);
 let failures=[];
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(production) res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(req.method!=='GET') return send(405,'Método não permitido.');
  if(req.url==='/health') return send(200,'{"status":"ok"}','application/json');
  failures=failures.filter(t=>t>now()-60000);
  if(failures.length>=10){res.setHeader('Retry-After','60');return send(429,'Muitas tentativas. Aguarde um minuto.');}
  const auth=req.headers.authorization||'';
  const value=auth.startsWith('Basic ')?Buffer.from(auth.slice(6),'base64').toString('utf8'):'';
  if(!timingSafeEqual(hash(value),expected)){
   if(auth) failures.push(now());
   res.setHeader('WWW-Authenticate','Basic realm="Gestor de anuncios", charset="UTF-8"');
   return send(401,'Entre com o usuário admin e a senha configurada no Render.');
  }
  if(req.url!=='/') return send(404,'Página não encontrada.');
  return send(200,html,'text/html; charset=utf-8');
 });
 server.headersTimeout=10000;
 server.requestTimeout=15000;
 return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const server=createApp({password:process.env.ADMIN_PASSWORD,production:process.env.NODE_ENV==='production'});
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Aplicativo iniciado.'));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
