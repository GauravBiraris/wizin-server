// src/common/guards/firebase-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split('Bearer ')[1];

    try {
      // Verify the token statelessly using Firebase Admin
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Extract the payload and custom claims
      request.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        tenantId: decodedToken.tenantId, 
        role: decodedToken.role,         
      };

      // Strict enforcement: Reject if user has no assigned tenant
      if (!request.user.tenantId) {
        throw new UnauthorizedException('User is not assigned to a tenant workspace.');
      }

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired Firebase token');
    }
  }
}