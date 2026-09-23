import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Reset the demo database to its seeded baseline before the suite runs.
 *
 * Without this, every run leaves orders, tasks and consumed stock behind, and
 * specs start drifting for reasons that have nothing to do with the code:
 * a product runs out of stock so a quantity stepper will not go high enough,
 * or a completed task falls off the first page because hundreds accumulated.
 * Those look like flakes but are really tests reading whatever state the last
 * run happened to leave.
 *
 * The reset uses the project's own maintenance script, so the baseline here is
 * the same one a developer gets from `npm run trim:orders`.
 */
export default function globalSetup(): void {
  const backend = path.resolve(import.meta.dirname, '../../backend');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', 'trim:orders'], {
    cwd: backend,
    stdio: 'inherit',
    // Windows resolves npm.cmd through the shell.
    shell: process.platform === 'win32',
  });
}
