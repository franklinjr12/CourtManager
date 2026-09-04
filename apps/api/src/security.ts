import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(nodeScrypt);
export const hashToken = (token:string) => createHash('sha256').update(token).digest('hex');
export const createToken = () => randomBytes(32).toString('base64url');
export const hashPassword = async (password:string) => { const salt=randomBytes(16); const key=await scrypt(password,salt,64) as Buffer; return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`; };
export const verifyPassword = async (password:string, stored:string) => { const [,saltHex,keyHex]=stored.split(':'); if(!saltHex||!keyHex)return false; const key=await scrypt(password,Buffer.from(saltHex,'hex'),64) as Buffer; const expected=Buffer.from(keyHex,'hex'); return expected.length===key.length && timingSafeEqual(expected,key); };
