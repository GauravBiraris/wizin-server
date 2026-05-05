import { Injectable, BadRequestException } from '@nestjs/common';
import * as admin from 'firebase-admin'; // Requires firebase-admin SDK
import { db } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class UsersService {
  
  async createSubUser(tenantId: string, adminEmail: string, payload: { email: string, name: string, role: 'ADMIN' | 'MANAGER'| 'SUPERVISOR' | 'OPERATOR', password: string }) {
    try {
      // 1. Create the user in Firebase Auth
      const userRecord = await admin.auth().createUser({
        email: payload.email,
        password: payload.password,
        displayName: payload.name,
      });

      // 2. THE SECRET SAUCE: Inject Tenant ID and Role directly into the Firebase Token
      await admin.auth().setCustomUserClaims(userRecord.uid, {
        tenantId: tenantId,
        role: payload.role
      });

      // 3. Save to your Postgres Database for foreign keys (like 'recordedBy')
      const [newUser] = await db.insert(schema.users).values({
        tenantId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        firebaseUid: userRecord.uid
      }).returning();

      return { success: true, user: newUser };

    } catch (error: any) {
      if (error.code === 'auth/email-already-exists') {
        throw new BadRequestException('A user with this email already exists.');
      }
      throw new BadRequestException(`Failed to create sub-user: ${error.message}`);
    }
  }

  async getTeam(tenantId: string) {
    return await db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      isActive: schema.users.isActive
    })
    .from(schema.users)
    .where(eq(schema.users.tenantId, tenantId));
  }

}