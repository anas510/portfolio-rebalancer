// Initialise the database schema and seed symbol aliases.
// Usage: npm run db:seed
import { initDb } from "../src/lib/db";
import { getAliases } from "../src/lib/repo";

async function main() {
  await initDb();
  const aliases = await getAliases();
  console.log(`Database ready. ${aliases.length} symbol aliases seeded.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
