import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
async function bootstrap() {
  if (!process.env.DATABASE_URL)
    throw new Error("Configura DATABASE_URL en .env antes de iniciar.");
  const app = await NestFactory.create(AppModule);
  // En producción la terminación TLS puede ocurrir en un proxy inverso. Esta
  // configuración permite que Express reconozca X-Forwarded-Proto=https.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use(cookieParser());
  const allowedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:4200";
  app.enableCors({ origin: allowedOrigin, credentials: true });
  app.use((req: any, res: any, next: () => void) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV === "production" && !req.secure) {
      return res.status(426).json({
        message: "Se requiere HTTPS para proteger las credenciales.",
      });
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== allowedOrigin
    ) {
      return res.status(403).json({ message: "Origen no autorizado." });
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
void bootstrap();
