import { inject,Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { AssistantMessage,AssistantSession } from "./models";
@Injectable({providedIn:"root"})
export class AssistantApi{
 private http=inject(HttpClient);
 session(){return this.http.get<AssistantSession>("/api/assistant");}
 newConversation(){return this.http.post<AssistantSession>("/api/assistant/conversations",{});}
 ask(message:string){return this.http.post<AssistantMessage&{conversationId:string;matched:boolean;suggestions:string[];quota:AssistantSession["quota"]}>("/api/assistant/messages",{message});}
}
