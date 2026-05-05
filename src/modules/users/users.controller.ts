import { Controller, Post, Body, Get, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';

@Controller('api/users')
// IMPORTANT: Apply the RolesGuard to the whole controller so it reads the decorators
@UseGuards(FirebaseAuthGuard, RolesGuard) 
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('create')
  @Roles('ADMIN') // ONLY Admins can create sub-users and incur licensing costs
  async createSubUser(
    @Request() req: any, 
    @Body() payload: { email: string, name: string, role: 'ADMIN' | 'MANAGER' | 'OPERATOR', password: string }
  ) {
    return this.usersService.createSubUser(req.user.tenantId, req.user.email, payload);
  }

  @Get('team')
  @Roles('ADMIN', 'MANAGER') // Admins and Managers can view the team roster
  async getTeam(@Request() req: any) {
    return this.usersService.getTeam(req.user.tenantId);
  }
}