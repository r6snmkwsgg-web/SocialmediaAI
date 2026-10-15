/**
 * Applies the database migrations in supabase/migrations, in order, to the
 * database in DATABASE_URL, remembering which have run. On Supabase you
 * can use their CLI (`supabase db push`) instead; this does the same job
 * without it.
 *
 *   pnpm db:migrate            the database in .env.local
 *   pnpm db:migrate --local    a plain local Postgres: adds the bits of Supabase the migrations need first
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (in .env.local) to the database to migrate.");
  process.exit(1);
}

const local = process.argv.includes("--local");
const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });

try {
  if (local) {
    await sql.unsafe(readFileSync("supabase/local.sql", "utf8"));
    console.log("Local Supabase shim in place.");
  }
  await sql`create schema if not exists hookline`;
  await sql`create table if not exists hookline.migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from hookline.migrations`).map((r) => r.name));
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), "utf8"));
      await tx`insert into hookline.migrations (name) values (${f})`;
    });
    console.log(`Applied ${f}`);
    ran++;
  }
  console.log(ran ? `${ran} migration${ran === 1 ? "" : "s"} applied.` : "Already up to date.");
} finally {
  await sql.end();
}
