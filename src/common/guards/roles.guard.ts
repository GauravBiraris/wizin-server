import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are specified, allow access (or default to block, depending on your strictness)
    if (!requiredRoles) {
      return true; 
    }

    const { user } = context.switchToHttp().getRequest();

    // 'user.role' is populated by your Firebase Auth middleware unpacking the JWT custom claims
    if (!user || !user.role) {
      throw new ForbiddenException('Access denied. No role assigned.');
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(`Access denied. Requires one of: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}