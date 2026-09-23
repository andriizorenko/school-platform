import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(input: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of input) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(input: string) {
  let bits=0,value=0; const out:number[]=[];
  for(const ch of input.replace(/=+$/," ").trim().toUpperCase()){const idx=alphabet.indexOf(ch);if(idx<0)continue;value=(value<<5)|idx;bits+=5;if(bits>=8){out.push((value >>> (bits-8)) & 255);bits-=8;}}
  return Buffer.from(out);
}
function totp(secret:string,time=Date.now(),step=30){const counter=Math.floor(time/1000/step);const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(counter));const digest=createHmac("sha1",base32Decode(secret)).update(b).digest();const offset=digest[digest.length-1]&15;const code=((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).toString().padStart(6,"0");return code;}

@Injectable()
export class MfaService {
  constructor(@Inject(DATABASE) private readonly db:Database,private readonly config:ConfigService){}
  private key(){return createHash("sha256").update(this.config.get<string>("MFA_ENCRYPTION_KEY",this.config.get<string>("APP_ENCRYPTION_KEY","dev-change-me"))).digest();}
  private encrypt(value:string){const iv=randomBytes(12);const c=createCipheriv("aes-256-gcm",this.key(),iv);const body=Buffer.concat([c.update(value,"utf8"),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString("base64url");}
  private decrypt(value:string){const data=Buffer.from(value,"base64url"),iv=data.subarray(0,12),tag=data.subarray(12,28),body=data.subarray(28);const d=createDecipheriv("aes-256-gcm",this.key(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]).toString("utf8");}
  async status(userId:string){const r=await this.db.execute(sql`SELECT type,enabled_at FROM mfa_methods WHERE user_id=${userId} AND type='TOTP'`);return {enabled:!!(r.rows[0] as any)?.enabled_at,type:r.rowCount?"TOTP":null};}
  async setup(userId:string,email:string){const existing=await this.db.execute(sql`SELECT secret_encrypted,enabled_at FROM mfa_methods WHERE user_id=${userId} AND type='TOTP'`);if((existing.rows[0] as any)?.enabled_at)throw new BadRequestException({code:"MFA_ALREADY_ENABLED",message:"MFA is already enabled"});const secret=base32Encode(randomBytes(20));await this.db.execute(sql`INSERT INTO mfa_methods(user_id,type,secret_encrypted) VALUES(${userId},'TOTP',${this.encrypt(secret)}) ON CONFLICT(user_id,type) DO UPDATE SET secret_encrypted=EXCLUDED.secret_encrypted,enabled_at=NULL,created_at=now()`);const issuer=encodeURIComponent("School Platform"),label=encodeURIComponent(`School Platform:${email}`);return {secret,otpauthUri:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`};}
  private verifyTotp(secret:string,code:string){return [-1,0,1].some(w=>totp(secret,Date.now()+w*30_000)===code.replace(/\s/g,""));}
  async enable(userId:string,sessionId:string,code:string){const r=await this.db.execute(sql`SELECT secret_encrypted FROM mfa_methods WHERE user_id=${userId} AND type='TOTP'`);if(!r.rowCount)throw new NotFoundException({code:"MFA_SETUP_REQUIRED",message:"Start MFA setup first"});const secret=this.decrypt((r.rows[0] as any).secret_encrypted);if(!this.verifyTotp(secret,code))throw new UnauthorizedException({code:"MFA_CODE_INVALID",message:"Invalid authentication code"});const recovery=Array.from({length:8},()=>randomBytes(6).toString("base64url").toUpperCase());await this.db.transaction(async tx=>{await tx.execute(sql`UPDATE mfa_methods SET enabled_at=now() WHERE user_id=${userId} AND type='TOTP'`);await tx.execute(sql`DELETE FROM mfa_recovery_codes WHERE user_id=${userId}`);for(const item of recovery)await tx.execute(sql`INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES(${userId},${createHash("sha256").update(item).digest("hex")})`);await tx.execute(sql`UPDATE user_sessions SET mfa_verified_at=now() WHERE id=${sessionId} AND user_id=${userId}`);});return {enabled:true,recoveryCodes:recovery};}
  async verify(userId:string,sessionId:string,code:string){const r=await this.db.execute(sql`SELECT secret_encrypted,enabled_at FROM mfa_methods WHERE user_id=${userId} AND type='TOTP'`);if(!r.rowCount||!(r.rows[0] as any).enabled_at)throw new NotFoundException({code:"MFA_NOT_ENABLED",message:"MFA is not enabled"});const secret=this.decrypt((r.rows[0] as any).secret_encrypted);let valid=this.verifyTotp(secret,code);if(!valid){const hash=createHash("sha256").update(code.trim().toUpperCase()).digest("hex");const recovery=await this.db.execute(sql`UPDATE mfa_recovery_codes SET used_at=now() WHERE id=(SELECT id FROM mfa_recovery_codes WHERE user_id=${userId} AND code_hash=${hash} AND used_at IS NULL LIMIT 1) RETURNING id`);valid=!!recovery.rowCount;}if(!valid)throw new UnauthorizedException({code:"MFA_CODE_INVALID",message:"Invalid authentication or recovery code"});await this.db.execute(sql`UPDATE user_sessions SET mfa_verified_at=now() WHERE id=${sessionId} AND user_id=${userId}`);return {verified:true};}
}
