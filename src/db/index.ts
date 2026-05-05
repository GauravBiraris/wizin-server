// src/db/index.ts
import { config } from 'dotenv';
config(); 

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Create a standard, highly efficient TCP connection pool
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL!,
  // Optional: Add SSL config if Neon strictly requires it for standard TCP
  ssl: { rejectUnauthorized: false } 
});

export const db = drizzle(pool, { schema });