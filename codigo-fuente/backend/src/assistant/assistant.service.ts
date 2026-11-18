import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { SessionUser } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { normalizeReference } from "../product/ingestion-rules";

const DAILY_LIMIT = 20;
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const stop = new Set([
  "a", "al", "como", "con", "cual", "de", "del", "el", "en", "es", "esta",
  "este", "la", "las", "lo", "los", "me", "mi", "para", "por", "puedo",
  "que", "se", "un", "una", "y",
]);
const caseTerms = new Set([
  "causa", "caso", "estado", "materia", "tribunal", "prioridad", "fecha",
  "audiencia", "razon", "razones", "avance", "resumen", "rit",
]);
const words = (value: string) =>
  normalize(value).split(" ").filter((word) => word.length > 1 && !stop.has(word));

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[b.length];
}

function similar(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  const allowed = Math.max(a.length, b.length) >= 7 ? 2 : 1;
  const difference = distance(a, b);
  return difference <= allowed ? 1 - difference / Math.max(a.length, b.length) : 0;
}

type CaseRow = {
  reference: string; rit: string | null; title: string; matter: string; court: string;
  priority: string; status: string; nextDate: string | null; nextDateLabel: string | null;
  clientName: string; progressSummary: string | null; nextAction: string | null;
};

@Injectable()
export class AssistantService {
  constructor(private db: DatabaseService) {}

  private async conversation(user: SessionUser, force = false) {
    if (!force) {
      const found = (await this.db.query("SELECT id FROM assistant_conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [user.id])).rows[0];
      if (found) return found.id;
    }
    return (await this.db.query("INSERT INTO assistant_conversations(user_id) VALUES($1) RETURNING id", [user.id])).rows[0].id;
  }

  private async used(user: SessionUser) {
    return Number((await this.db.query(
      `SELECT count(*)::int AS total FROM assistant_messages
       WHERE user_id=$1 AND role='USER'
         AND (created_at AT TIME ZONE 'America/Santiago')::date=(now() AT TIME ZONE 'America/Santiago')::date`,
      [user.id],
    )).rows[0].total);
  }

  async session(user: SessionUser) {
    const id = await this.conversation(user);
    const messages = (await this.db.query(
      `SELECT id,role,content,confidence,created_at AS "createdAt" FROM assistant_messages
       WHERE conversation_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 60`,
      [id, user.id],
    )).rows.reverse();
    const used = await this.used(user);
    return { conversationId: id, messages, quota: { limit: DAILY_LIMIT, used, remaining: Math.max(0, DAILY_LIMIT - used) } };
  }

  async newConversation(user: SessionUser) {
    const id = await this.conversation(user, true);
    const used = await this.used(user);
    return { conversationId: id, messages: [], quota: { limit: DAILY_LIMIT, used, remaining: Math.max(0, DAILY_LIMIT - used) } };
  }

  /** E21: "LC-01", "lc 0001" o "LC#1" se normalizan a "LC-1", como las genera el servidor. */
  private caseIdentifier(message: string) {
    const reference = message.match(/\bLC\s*[-:#]?\s*(\d+)\b/i);
    if (reference) return normalizeReference(`LC-${reference[1]}`);
    return message.match(/\b[A-Z]{1,4}-\d{1,10}-\d{4}\b/i)?.[0] || null;
  }

  private scope(user: SessionUser, values: unknown[]) {
    if (user.role === "SUPERVISOR") return "true";
    values.push(user.id);
    return user.role === "LAWYER" ? `c.lawyer_id=$${values.length}` : `c.client_id=$${values.length}`;
  }

  private async accessibleCases(user: SessionUser, identifier?: string) {
    const values: unknown[] = [];
    const scope = this.scope(user, values);
    let identifierClause = "";
    if (identifier) {
      values.push(identifier);
      identifierClause = `AND (upper(c.reference)=upper($${values.length}) OR upper(c.rit)=upper($${values.length}))`;
    }
    return (await this.db.query(
      `SELECT c.reference,c.rit,c.title,c.matter,c.court,c.priority,c.status,
        to_char(c.next_date,'DD/MM/YYYY') AS "nextDate",c.next_date_label AS "nextDateLabel",
        u.name AS "clientName",c.progress_summary AS "progressSummary",c.next_action AS "nextAction"
       FROM cases c JOIN users u ON u.id=c.client_id
       WHERE ${scope} ${identifierClause} ORDER BY c.updated_at DESC LIMIT 100`,
      values,
    )).rows as CaseRow[];
  }

  private describeCase(item: CaseRow, message: string, user: SessionUser) {
    const parts = [
      `La causa ${item.reference}${item.rit ? ` (RIT ${item.rit})` : ""}, “${item.title}”, está ${item.status.toLowerCase()}.`,
      `Corresponde a ${item.matter.toLowerCase()}, se tramita en ${item.court} y tiene prioridad ${item.priority.toLowerCase()}.`,
      item.nextDate ? `Su próxima fecha es el ${item.nextDate}${item.nextDateLabel ? `: ${item.nextDateLabel}` : ""}.` : "No tiene una próxima fecha registrada.",
    ];
    const asksReason = /\b(por que|razon|razones|motivo)\b/.test(normalize(message));
    if (user.role !== "CLIENT" && item.progressSummary) parts.push(`Avance registrado: ${item.progressSummary}`);
    if (user.role !== "CLIENT" && item.nextAction) parts.push(`Próxima acción: ${item.nextAction}`);
    if (asksReason && !item.progressSummary) parts.push("No hay un motivo o resumen de avance registrado; Lexi no infiere razones jurídicas.");
    return parts.join(" ");
  }

  private async caseAnswer(message: string, user: SessionUser) {
    const identifier = this.caseIdentifier(message);
    if (identifier) {
      const found = await this.accessibleCases(user, identifier);
      return found[0]
        ? { answer: this.describeCase(found[0], message, user), confidence: 1 }
        : { answer: `No encontré una causa accesible con la referencia o RIT ${identifier}. Revisa el código y tus permisos.`, confidence: 1 };
    }
    const queryWords = words(message);
    if (!queryWords.some((word) => caseTerms.has(word))) return null;
    const distinctive = queryWords.filter((word) => !caseTerms.has(word) && !["ver", "saber", "dime"].includes(word));
    if (distinctive.length < 2) return null;
    const scored = (await this.accessibleCases(user)).map((item) => {
      const target = words(`${item.title} ${item.clientName} ${item.rit || ""}`);
      const hits = distinctive.reduce((total, query) => total + Math.max(0, ...target.map((word) => similar(query, word))), 0);
      return { item, score: hits / distinctive.length };
    }).filter((result) => result.score >= 0.65).sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    if (scored[1] && scored[0].score - scored[1].score < 0.15) {
      return { answer: `Encontré más de una causa posible: ${scored.slice(0, 3).map(({ item }) => `${item.reference} — ${item.title}`).join("; ")}. Indica la referencia LC o el RIT.`, confidence: scored[0].score };
    }
    return { answer: this.describeCase(scored[0].item, message, user), confidence: scored[0].score };
  }

  private legalAdviceAnswer(message: string) {
    const value = normalize(message);
    const asksForDecision = /\b(debo|conviene|recomienda|recomiendas|estrategia|demandar|demandarlo|apelar|denunciar|ganar|probabilidad|pronostico)\b/.test(value);
    const legalContext = /\b(legal|juridic|juicio|causa|caso|demanda|tribunal|abogado|querella|recurso|pension|despido)\b/.test(value);
    if (!asksForDecision || !legalContext) return null;
    return {
      answer: "No puedo recomendar una estrategia, predecir el resultado ni indicarte si debes demandar, apelar o realizar otra acción jurídica. Puedo mostrar datos registrados en LEX-CORPUS, pero esa decisión debe revisarla el abogado responsable.",
      confidence: 1,
    };
  }

  private privacyAnswer(message: string) {
    const value = normalize(message);
    const asksForSensitiveData = /\b(datos privados|notas internas|credenciales|contrasenas|todas las causas|otra cartera|otro abogado|otro cliente)\b/.test(value);
    const asksToReveal = /\b(muestra|muestrame|mostrar|dime|dame|ver|revela|revelar|ignora)\b/.test(value);
    if (!asksForSensitiveData || !asksToReveal) return null;
    return {
      answer: "No puedo mostrar notas internas, credenciales ni información de causas fuera de tu acceso. Lexi aplica los mismos permisos de LEX-CORPUS: solo consulta las causas autorizadas para tu cuenta.",
      confidence: 1,
    };
  }

  async ask(message: string, user: SessionUser) {
    const used = await this.used(user);
    if (used >= DAILY_LIMIT) throw new HttpException(`Alcanzaste el límite diario de ${DAILY_LIMIT} preguntas. Intenta nuevamente mañana.`, HttpStatus.TOO_MANY_REQUESTS);
    const conversationId = await this.conversation(user);
    const dynamic = this.privacyAnswer(message) || this.legalAdviceAnswer(message) || await this.caseAnswer(message, user);
    const knowledge = dynamic ? [] : (await this.db.query(
      `SELECT id,intent,question,answer,keywords,audience FROM assistant_knowledge WHERE active=true AND audience IN ('ALL',$1)`,
      [user.role],
    )).rows;
    const queryWords = words(message);
    const scored = knowledge.map((item: any) => {
      const targets = [...item.keywords.flatMap((keyword: string) => words(keyword)), ...words(item.question)];
      let hits = 0;
      for (const query of queryWords) {
        let best = 0;
        for (const target of targets) best = Math.max(best, similar(query, target));
        hits += best;
      }
      const phrase = normalize(item.question).includes(normalize(message)) || normalize(message).includes(normalize(item.intent.replace(/_/g, " "))) ? 0.35 : 0;
      return { item, score: Math.min(1, hits / Math.max(2, queryWords.length) + phrase) };
    }).sort((a: any, b: any) => b.score - a.score);
    const best = scored[0];
    const matched = best && best.score >= 0.34 ? best : null;
    const suggestions = scored.slice(0, 3).map((result: any) => result.item.question);
    const answer = dynamic ? dynamic.answer : matched ? matched.item.answer : `No encontré una respuesta suficientemente segura para esa pregunta. Puedes probar con: ${suggestions.map((suggestion: string) => `“${suggestion}”`).join(", ")}. Si la consulta es jurídica, contacta al abogado responsable.`;
    const confidence = dynamic?.confidence || matched?.score || 0;

    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO assistant_messages(conversation_id,user_id,role,content) VALUES($1,$2,'USER',$3)`, [conversationId, user.id, message]);
      const saved = (await client.query(
        `INSERT INTO assistant_messages(conversation_id,user_id,role,content,matched_knowledge_id,confidence)
         VALUES($1,$2,'ASSISTANT',$3,$4,$5) RETURNING id,role,content,confidence,created_at AS "createdAt"`,
        [conversationId, user.id, answer, matched?.item.id || null, confidence],
      )).rows[0];
      await client.query("UPDATE assistant_conversations SET updated_at=now() WHERE id=$1", [conversationId]);
      await client.query("COMMIT");
      return { ...saved, conversationId, matched: Boolean(dynamic || matched), suggestions, quota: { limit: DAILY_LIMIT, used: used + 1, remaining: DAILY_LIMIT - used - 1 } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
