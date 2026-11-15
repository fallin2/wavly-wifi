import postgres from 'postgres';

// Serverless-safe singleton: reuse the connection across warm invocations.
// prepare:false is REQUIRED for the Supabase transaction pooler (pgBouncer, port 6543).
type AnySql = postgres.Sql<Record<string, any>>;
const globalForDb = globalThis as unknown as { __wavlySql?: AnySql };

export function getDb(): AnySql {
  if (!globalForDb.__wavlySql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.__wavlySql = postgres<Record<string, any>>(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      // Supabase requires TLS; most client builds honour sslmode=require in the URL.
      ssl: url.includes('sslmode=disable') ? false : 'require',
    });
  }
  return globalForDb.__wavlySql;
}
