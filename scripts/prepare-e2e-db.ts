// Creates a fresh, migrated database for the Playwright run. Not for production.
import { recreateDatabase, runMigrate, urlForDatabase } from '../test/helpers/db.js';

export const E2E_DB = 'il_e2e';
await recreateDatabase(E2E_DB);
await runMigrate(urlForDatabase(E2E_DB), 'up');
console.log(`e2e database ${E2E_DB} ready`);
