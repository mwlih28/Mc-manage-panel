// Run once at the end of a fresh install-panel.sh — populates the Eggs
// catalog from the same live community source Admin -> Eggs -> Browse
// Community Eggs -> Import All Categories uses, so a brand-new install
// starts with the full ~299-egg library instead of an empty Eggs page.
//
// Deliberately never fails the install: any error here (no internet
// during setup, the community repo being briefly unreachable, etc.) is
// caught and logged, and the process exits 0 regardless — the admin can
// always re-run this from the panel's own UI later. Not wired into
// update-panel.sh on purpose: an existing install upgrading shouldn't have
// ~299 eggs silently dumped into it on every update.
import { EGG_STORE_CATEGORIES, listCategoryEggs, importStoreEggsBulk } from '../services/eggStore';

async function main() {
  let totalImported = 0;
  let totalFailed = 0;

  for (const cat of EGG_STORE_CATEGORIES) {
    try {
      const entries = await listCategoryEggs(cat.slug);
      if (entries.length === 0) {
        console.log(`  ${cat.label}: no eggs found`);
        continue;
      }
      const results = await importStoreEggsBulk(cat.slug, entries.map((e) => e.path), { nestName: cat.label });
      const ok = results.filter((r) => r.success).length;
      totalImported += ok;
      totalFailed += results.length - ok;
      console.log(`  ${cat.label}: imported ${ok}/${results.length}`);
    } catch (err) {
      console.warn(`  ${cat.label}: skipped — ${(err as Error).message}`);
    }
  }

  console.log(`Egg seeding done: ${totalImported} imported, ${totalFailed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.warn(`Egg seeding failed, continuing without it: ${(err as Error).message}`);
    process.exit(0);
  });
