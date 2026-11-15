import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProductController } from "./product.controller";
import { ProductService } from "./product.service";
import { IncomingEmailController } from "./incoming-email.controller";
@Module({imports:[AuthModule],controllers:[ProductController,IncomingEmailController],providers:[ProductService]})
export class ProductModule{}
