// Runs the test-only GitHub stub as a process for the Playwright e2e run.
import { startStub } from './stub-github.js';
import { addRepoRoutes } from './stub-github-repos.js';

const stub = await startStub({ clientId: 'e2e-client', clientSecret: 'e2e-secret' }, 4010, addRepoRoutes);
console.log(`github stub on ${stub.baseUrl}`);
