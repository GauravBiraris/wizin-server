// src/modules/auth/auth.controller.ts
import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { InviteTenantDto } from './auth.service';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('invite-tenant')
  async inviteTenant(
    @Headers('x-platform-secret') platformSecret: string,
    @Body() dto: InviteTenantDto
  ) {
    if (!platformSecret) {
      throw new UnauthorizedException('Missing platform secret header');
    }
    
    return this.authService.inviteTenant(platformSecret, dto);
  }
}