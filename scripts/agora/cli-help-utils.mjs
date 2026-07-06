export function usageText() {
  return `Usage:
  node scripts/agora.mjs prepare [local|balanced|max]
  node scripts/agora.mjs council [--dry-run] "question"
  node scripts/agora.mjs ask [--min|--balanced|--max|--all] [--confirm-all] [--philosophers list] "question"
  node scripts/agora.mjs ask --dry-run --philosophers socrates,kant "question"
  node scripts/agora.mjs follow-up <root-issue> [--voices list] "question"
  node scripts/agora.mjs dialogue <philosopher> "question"
  node scripts/agora.mjs dialogue-context <root-issue> <philosopher> "question"
  node scripts/agora.mjs synthesize [root-issue-id-or-key] [--fresh]
  node scripts/agora.mjs export-memory <issue-id-or-key>
  node scripts/agora.mjs philosophers [--tags|--tag TAG]
  node scripts/agora.mjs philosopher-search [--json] "name or alias"
  node scripts/agora.mjs role-proposal [--json] [--limit N] [--mode MODE] [--no-architects] "topic"
  node scripts/agora.mjs chamber [list|current|use <id>]
  node scripts/agora.mjs policy [skill-id]
  node scripts/agora.mjs skills [role-key] [--json]
  node scripts/agora.mjs start [--json]
  node scripts/agora.mjs wizard
  node scripts/agora.mjs wizard-answer "answer"
  node scripts/agora.mjs understand [--routing-mode regex|llm] [--json] "human text"
  node scripts/agora.mjs natural [--routing-mode regex|llm] [--dry-run] [--json] "human text"
  node scripts/agora.mjs mode [get|set <min|balanced|max|local>|--raw]
  node scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N] [--pricing env|default|off|FILE]
  node scripts/agora.mjs status
  node scripts/agora.mjs recheck [issue-id-or-key]
  node scripts/agora.mjs tasks [--all|--open] [--limit N]
  node scripts/agora.mjs latest [issue-id-or-key]
  node scripts/agora.mjs result [issue-id-or-key] [--full]
  node scripts/agora.mjs voice <philosopher> [issue-id-or-key] [--full]
  node scripts/agora.mjs task <issue-id-or-key>
  node scripts/agora.mjs finalize <issue-id-or-key> [--dry-run]
  node scripts/agora.mjs move <issue-id-or-key> <todo|in_progress|blocked|done|cancelled>
  node scripts/agora.mjs comments <issue-id-or-key>

Modes:
  council   fixed MVP council: Plato, Descartes, Heidegger
  min       3 voices, usually architects or explicitly selected philosophers
  balanced 7 voices by default
  max       12 voices by default
  all       every role in the current roster
`;
}
