import { SetMetadata } from '@nestjs/common';

// This allows us to write @Roles('ADMIN', 'MANAGER') above our controllers
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);