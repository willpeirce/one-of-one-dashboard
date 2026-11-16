import {pathToFileURL} from 'node:url';
import {GorgiasClient, gorgiasCredentials, type GorgiasCredentials, type GorgiasProbeReader} from '../src/gorgias/client.js';
import {runGorgiasProbe} from '../src/gorgias/probe.js';

const usage = 'Usage: npm run probe:gorgias -- [--help]. Reads one tickets page and one views page; prints counts, field names, view ids/names and pagination shapes only.';
export async function probeGorgiasCommand(args: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env,
  line: (text: string) => void = console.log, makeClient: (credentials: GorgiasCredentials) => GorgiasProbeReader = credentials => new GorgiasClient(credentials)): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { line(usage); return 0; }
  if (args.length) { line(usage); return 2; }
  const credentials = gorgiasCredentials(env);
  if (!credentials) { line('Gorgias probe: waiting for GORGIAS_DOMAIN, GORGIAS_EMAIL and GORGIAS_API_KEY; no requests made.'); return 0; }
  try { return (await runGorgiasProbe(makeClient(credentials), line)).complete ? 0 : 1; }
  catch { line('Gorgias probe could not complete. No response data was printed.'); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await probeGorgiasCommand();
