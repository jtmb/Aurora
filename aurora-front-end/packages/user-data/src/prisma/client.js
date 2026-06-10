// @aurora/user-data - Prisma Client
// Database client initialization for PostgreSQL with Aurora Gateway schema

import { PrismaClient } from '@libsql/client';

const globalForPrisma = globalThis;

// Initialize Prisma client for production
let prisma;

if (process.env.NODE_ENV === 'production' || !globalForPrisma.prisma) {
  prisma = new PrismaClient({
    log: ['query'], // Enable query logging in development
  });
  
  globalForPrisma.prisma = prisma;
} else {
  prisma = globalForPrisma.prisma;
}

export default prisma;