import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { AllowTemporaryPassword, AuthGuard, AuthRequest } from "./auth.guard";
class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
class ForgotPasswordDto { @IsEmail() @MaxLength(254) email!: string; }
class ResetPasswordDto {
  @IsString() @MinLength(64) @MaxLength(64) token!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    res.cookie("lex_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api",
      maxAge: 8 * 60 * 60 * 1000,
    });
    return user;
  }
  @Get("me")
  @UseGuards(AuthGuard)
  @AllowTemporaryPassword()
  me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Post("extend")
  @UseGuards(AuthGuard)
  @AllowTemporaryPassword()
  async extend(@Req() req: AuthRequest) {
    // AuthGuard ya validó y renovó last_seen_at de forma atómica.
    return { ok: true, user: req.user };
  }
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.lex_session);
    res.clearCookie("lex_session", { path: "/api" });
    return { ok: true };
  }
  @Post("change-password")
  @UseGuards(AuthGuard)
  @AllowTemporaryPassword()
  changePassword(@Req() req: AuthRequest,@Body() dto:ChangePasswordDto){
    return this.auth.changePassword(req.user,dto.currentPassword,dto.newPassword);
  }
  @Post("forgot-password")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  forgot(@Body() dto:ForgotPasswordDto){return this.auth.forgotPassword(dto.email);}
  @Post("reset-password")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() dto:ResetPasswordDto){return this.auth.resetPassword(dto.token,dto.newPassword);}
}
