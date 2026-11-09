import { pathToFileURL } from 'node:url';
import { MailchimpClient, type MailchimpReader } from '../src/mailchimp/client.js';
import { MAILCHIMP_PROBE_CAMPAIGN_LIMIT, runMailchimpProbe } from '../src/mailchimp/probe.js';

const usage = 'Usage: npm run probe:mailchimp -- [--campaign <id>] [--help]. Repeat --campaign for up to three campaigns. Reads only; prints endpoint status and field names.';
export async function probeMailchimpCommand(args: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env,
  line: (line: string) => void = console.log, makeClient: (token: string) => MailchimpReader = token => new MailchimpClient(token)): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { line(usage); return 0; }
  const campaignIds: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const id = args[index + 1];
    if (args[index] !== '--campaign' || !id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) { line(usage); return 2; }
    campaignIds.push(id);
  }
  if (new Set(campaignIds).size > MAILCHIMP_PROBE_CAMPAIGN_LIMIT) { line(usage); return 2; }
  const token = env.MAILCHIMP_API_KEY?.trim();
  if (!token) { line('Mailchimp probe: waiting for MAILCHIMP_API_KEY; no requests made.'); return 0; }
  try {
    const result = await runMailchimpProbe(makeClient(token), {campaignIds, line});
    return result.complete ? 0 : 1;
  } catch {
    line('Mailchimp probe could not complete. No response data was printed.');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await probeMailchimpCommand();
}
