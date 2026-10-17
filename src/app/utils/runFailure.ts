import { translateUi } from '../i18n';

/**
 * Why a run stopped, in one sentence a person can act on.
 *
 * Run errors arrive as whatever the agent, the CLI or the server raised;
 * the raw text stays in the run's details, and the card leads with this.
 */
const REASONS: Array<[RegExp, string]> = [
  [/cancelled by user/i, 'You cancelled this run.'],
  [/server restart/i, 'The server restarted while this ran.'],
  [/no heartbeat|stopped reporting/i, 'The machine running this stopped answering.'],
  [
    /EXECUTION_HOST_UNAVAILABLE|host (is )?(offline|unreachable|unavailable)|machine (is )?offline/i,
    'The machine this runs on is offline.',
  ],
  [
    /no longer has a path|path .*(does not exist|not found)|ENOENT.*(cwd|workspace)/i,
    "The project's folder is missing on that machine.",
  ],
  [/rate.?limit|\b429\b|too many requests/i, 'The AI service is busy. Try again in a moment.'],
  [/quota|insufficient.?(credit|balance)|billing/i, 'The AI account is out of credit.'],
  [
    /\b401\b|unauthori[sz]ed|not logged in|login required|invalid api key|authentication/i,
    'The AI tool is not signed in on that machine.',
  ],
  [
    /command not found|ENOENT|no such file or directory.*(claude|codex|opencode)/i,
    'The AI tool is not installed on that machine.',
  ],
  [/timed? ?out|timeout/i, 'The run took too long and was stopped.'],
  [/rejected/i, 'The result was rejected.'],
];

export function runFailureReason(error: string | null | undefined): string {
  if (!error) return translateUi('The run stopped before it finished.');
  const match = REASONS.find(([pattern]) => pattern.test(error));
  return translateUi(match ? match[1] : 'The run stopped with an error.');
}
