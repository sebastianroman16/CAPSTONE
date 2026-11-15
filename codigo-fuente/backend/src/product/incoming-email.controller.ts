import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { IncomingEmailDto } from "./product.dto";
import { ProductService } from "./product.service";

@Controller("webhooks/ingestion")
export class IncomingEmailController {
  constructor(private readonly product:ProductService){}

  @Post("email")
  receive(@Headers("x-ingestion-secret") provided:string|undefined,@Body() dto:IncomingEmailDto){
    const expected=process.env.INGESTION_WEBHOOK_SECRET;
    if(!expected||!provided||!this.sameSecret(expected,provided))
      throw new UnauthorizedException("Webhook no autorizado.");
    return this.product.ingestIncomingEmail(dto);
  }

  private sameSecret(expected:string,provided:string){
    const left=Buffer.from(expected);
    const right=Buffer.from(provided);
    return left.length===right.length&&timingSafeEqual(left,right);
  }
}
