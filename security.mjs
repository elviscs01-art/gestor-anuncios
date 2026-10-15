import {createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual} from 'node:crypto';
export const random = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const equal = (a,b) => timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'));
export const challenge = verifier => createHash('sha256').update(verifier).digest('base64url');
export const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function vault(secret) {
 if (typeof secret!=='string' || secret.length<32) throw new Error('TOKEN_ENCRYPTION_KEY deve ter pelo menos 32 caracteres aleatórios.');
 const key=createHash('sha256').update(secret).digest();
 return {
  seal(value,purpose='tokens') {
   const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
   cipher.setAAD(Buffer.from(purpose));
   const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
   return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.');
  },
  open(value,purpose='tokens') {
   const [version,iv,tag,bytes,...rest]=String(value).split('.');
   if(version!=='v1'||rest.length||!bytes) throw new Error('Registro criptografado inválido.');
   const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
   decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(Buffer.from(tag,'base64url'));
   return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes,'base64url')),decipher.final()]).toString('utf8'));
  }
 };
}
export class UserError extends Error {
 constructor(message,status=400){super(message);this.status=status;}
}

export const sessionStamp = (password,key) => createHmac('sha256',key).update('admin-session:').update(password).digest('hex');
