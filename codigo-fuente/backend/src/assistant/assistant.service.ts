import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SessionUser } from "../auth/auth.service";

const DAILY_LIMIT=20;
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9ñ\s]/g," ").replace(/\s+/g," ").trim();
const stop=new Set(["a","al","como","con","cual","de","del","el","en","es","esta","este","la","las","lo","los","me","mi","para","por","puedo","que","se","un","una","y"]);
const words=(value:string)=>normalize(value).split(" ").filter(w=>w.length>1&&!stop.has(w));
function distance(a:string,b:string){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}return row[b.length];}
function similar(a:string,b:string){if(a===b)return 1;if(a.length<3||b.length<3)return 0;const allowed=Math.max(a.length,b.length)>=7?2:1;const d=distance(a,b);return d<=allowed?1-d/Math.max(a.length,b.length):0;}

@Injectable()
export class AssistantService{
 constructor(private db:DatabaseService){}
 private async conversation(user:SessionUser,force=false){
  if(!force){const found=(await this.db.query("SELECT id FROM assistant_conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1",[user.id])).rows[0];if(found)return found.id;}
  return (await this.db.query("INSERT INTO assistant_conversations(user_id) VALUES($1) RETURNING id",[user.id])).rows[0].id;
 }
 private async used(user:SessionUser){return Number((await this.db.query(`SELECT count(*)::int AS total FROM assistant_messages WHERE user_id=$1 AND role='USER' AND (created_at AT TIME ZONE 'America/Santiago')::date=(now() AT TIME ZONE 'America/Santiago')::date`,[user.id])).rows[0].total);}
 async session(user:SessionUser){const id=await this.conversation(user);const messages=(await this.db.query(`SELECT id,role,content,confidence,created_at AS "createdAt" FROM assistant_messages WHERE conversation_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 60`,[id,user.id])).rows.reverse();const used=await this.used(user);return {conversationId:id,messages,quota:{limit:DAILY_LIMIT,used,remaining:Math.max(0,DAILY_LIMIT-used)}};}
 async newConversation(user:SessionUser){const id=await this.conversation(user,true);const used=await this.used(user);return {conversationId:id,messages:[],quota:{limit:DAILY_LIMIT,used,remaining:Math.max(0,DAILY_LIMIT-used)}};}
 async ask(message:string,user:SessionUser){
  const used=await this.used(user);if(used>=DAILY_LIMIT)throw new HttpException(`Alcanzaste el límite diario de ${DAILY_LIMIT} preguntas. Intenta nuevamente mañana.`,HttpStatus.TOO_MANY_REQUESTS);
  const conversationId=await this.conversation(user);const knowledge=(await this.db.query(`SELECT id,intent,question,answer,keywords,audience FROM assistant_knowledge WHERE active=true AND audience IN ('ALL',$1)`,[user.role])).rows;
  const queryWords=words(message);const scored=knowledge.map((item:any)=>{const targets=[...item.keywords.flatMap((k:string)=>words(k)),...words(item.question)];let hits=0;for(const q of queryWords){let best=0;for(const t of targets)best=Math.max(best,similar(q,t));hits+=best;}const phrase=normalize(item.question).includes(normalize(message))||normalize(message).includes(normalize(item.intent.replace(/_/g," ")))?0.35:0;return {item,score:Math.min(1,hits/Math.max(2,queryWords.length)+phrase)};}).sort((a:any,b:any)=>b.score-a.score);
  const best=scored[0];const matched=best&&best.score>=0.34?best:null;const suggestions=scored.slice(0,3).map((x:any)=>x.item.question);
  const answer=matched?matched.item.answer:`No encontré una respuesta suficientemente segura para esa pregunta. Puedes probar con: ${suggestions.map((s:string)=>`“${s}”`).join(", ")}. Si la consulta es jurídica, contacta al abogado responsable.`;
  const client=await this.db.pool.connect();try{await client.query("BEGIN");await client.query(`INSERT INTO assistant_messages(conversation_id,user_id,role,content) VALUES($1,$2,'USER',$3)`,[conversationId,user.id,message]);const saved=(await client.query(`INSERT INTO assistant_messages(conversation_id,user_id,role,content,matched_knowledge_id,confidence) VALUES($1,$2,'ASSISTANT',$3,$4,$5) RETURNING id,role,content,confidence,created_at AS "createdAt"`,[conversationId,user.id,answer,matched?.item.id||null,matched?.score||0])).rows[0];await client.query("UPDATE assistant_conversations SET updated_at=now() WHERE id=$1",[conversationId]);await client.query("COMMIT");return {...saved,conversationId,matched:Boolean(matched),suggestions,quota:{limit:DAILY_LIMIT,used:used+1,remaining:DAILY_LIMIT-used-1}};}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 }
}
