import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as admin from 'firebase-admin';
import * as path from 'path';

async function bootstrap() {
  // Dynamically resolve the absolute path from the project root
  const serviceAccountPath = path.resolve(process.cwd(), 'secrets/firebase-service-account.json');
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Required for your React frontend
  // Use Render's port, or fallback to 3001 for local dev
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on port: ${port}`);
}
bootstrap();