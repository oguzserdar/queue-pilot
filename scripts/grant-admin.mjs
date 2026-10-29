/**
 * Makes one signed-in Buffer user this deployment's admin, so they can open /admin.
 * Usage: DATABASE_URL=... pnpm admin:grant you@example.com
 * The person must have signed in with Buffer once, so their user row exists.
 */
import pg from "pg";

const email = process.argv[2]?.trim();
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!email) {
  console.error("Usage: pnpm admin:grant you@example.com");
  process.exit(1);
}
if (!url) {
  console.error("Set DATABASE_URL to this deployment's database first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(`update "user" set role = 'admin' where lower(email) = lower($1) returning email`, [email]);
  if (rows.length === 0) {
    console.error(`No user with the email ${email}. Sign in with Buffer once, then run this again.`);
    process.exitCode = 1;
  } else {
    console.log(`${rows[0].email} is now an admin. Open /admin.`);
  }
} finally {
  await client.end();
}
