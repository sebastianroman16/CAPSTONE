import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard,AuthRequest } from "../auth/auth.guard";
import { AssistantQuestionDto } from "./assistant.dto";
import { AssistantService } from "./assistant.service";
@Controller("assistant") @UseGuards(AuthGuard)
export class AssistantController{constructor(private assistant:AssistantService){}
 @Get() session(@Req()r:AuthRequest){return this.assistant.session(r.user);}
 @Post("conversations") conversation(@Req()r:AuthRequest){return this.assistant.newConversation(r.user);}
 @Post("messages") @Throttle({default:{limit:8,ttl:60000}}) ask(@Body()d:AssistantQuestionDto,@Req()r:AuthRequest){return this.assistant.ask(d.message,r.user);}
}
