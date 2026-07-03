# Bug Template

Use this JSON shape for machine-readable bugs:

```json
{
  "id": "TQA-001",
  "runId": "QA-...",
  "severity": "P0|P1|P2|P3",
  "area": "router|telegram-ui|paperclip-recovery|cleanup|local-model|state|docs",
  "testId": "help.basic",
  "symptom": "",
  "expected": "",
  "actual": "",
  "evidence": {
    "telegramMessageIds": [],
    "paperclipIssueRefs": [],
    "logSnippets": [],
    "transcript": ""
  },
  "rootCauseHypothesis": "",
  "acceptanceCriteria": []
}
```

Use this Markdown shape for human handoff:

```markdown
## TQA-001: Short Title

Severity: P1
Area: telegram-ui
Test: help.basic
Run: QA-...

Expected:

Actual:

Evidence:

Root cause hypothesis:

Acceptance criteria:
- 
```
