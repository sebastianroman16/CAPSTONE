import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { AuthService, SessionUser } from "./auth.service";
export type AuthRequest = Request & { user: SessionUser };
export const ALLOW_TEMPORARY_PASSWORD = "allowTemporaryPassword";
export const AllowTemporaryPassword = () => SetMetadata(ALLOW_TEMPORARY_PASSWORD, true);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    req.user = await this.auth.authenticate(req.cookies?.lex_session);
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_TEMPORARY_PASSWORD, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (req.user.mustChangePassword && !allowed) {
      throw new ForbiddenException({
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Debes cambiar tu contraseña temporal antes de continuar.",
      });
    }
    return true;
  }
}
