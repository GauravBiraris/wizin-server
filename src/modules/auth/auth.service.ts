import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { db } from '../../db'; 
import * as schema from '../../db/schema';

export interface InviteTenantDto {
  companyName: string;
  userName: string;
  email: string;
}

@Injectable()
export class AuthService {
  async inviteTenant(platformSecret: string, dto: InviteTenantDto) {
    // Basic security guard: Only YOU can trigger this endpoint using a secret key
    if (platformSecret !== process.env.PLATFORM_SECRET) {
      throw new UnauthorizedException('Invalid platform secret');
    }

    try {
      // 1. Create the Tenant in the Neon Database
      const [newTenant] = await db.insert(schema.tenants).values({
        name: dto.companyName,
        currency: 'INR',
      }).returning();

      // 2. Create the Firebase User (Without a password)
      const firebaseUser = await admin.auth().createUser({
        email: dto.email,
        displayName: dto.userName,
        emailVerified: false,
      });

      // 3. Inject Custom Claims into Firebase immediately
      await admin.auth().setCustomUserClaims(firebaseUser.uid, {
        tenantId: newTenant.id,
        role: 'ADMIN',
      });

      // 4. Create the User in the Neon Database
      await db.insert(schema.users).values({
        tenantId: newTenant.id,
        firebaseUid: firebaseUser.uid,
        name: dto.userName,
        email: dto.email,
        role: 'ADMIN',
        isActive: true,
      });

      // 5. Generate the official Firebase Password Setup Link
      const setupLink = await admin.auth().generatePasswordResetLink(dto.email);

      console.log('\n--- NEW TENANT SETUP LINK ---');
      console.log(setupLink);
      console.log('-----------------------------\n');

      return { 
        success: true, 
        message: 'Tenant provisioned successfully',
        tenantId: newTenant.id,
        setupLink: setupLink // You will copy this and send to the tenant via WhatsApp/Email
      };

    } catch (error: any) {
      console.error('Invitation Error:', error);
      throw new BadRequestException(error.message || 'Failed to invite tenant');
    }
  }
}