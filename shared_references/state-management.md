# Persistent State Management

All BD skills (outlook_triage, outlook_bd, linkedin_triage, linkedin_bd) share a single persistent state layer backed by **FalkorDB** (primary graph database) and **SQLite** (local backup). Every state operation goes through the CLI at `scripts/state_manager.py`.

## Invocation

```bash
python scripts/state_manager.py <command> [options]
```

All commands output JSON to stdout. Parse with `jq` or read directly. Exit code 0 = success, 1 = error.

## Environment Variables

Loaded from `scripts/.env` via python-dotenv.

| Variable | Purpose |
|---|---|
| `FALKORDB_URL` | FalkorDB Cloud connection string |
| `APOLLO_API_KEY` | Apollo REST API key |

## Graph Schema

### Node Types

| Node | Key Properties | Merge Key |
|---|---|---|
| **Contact** | name, email, linkedin_url, title, company_name, persona_lane, motion_type, classification, hubspot_contact_id, last_contacted, last_channel, last_action, linkedin_connection_status, linkedin_connection_sent_at, do_not_contact_email, do_not_contact_linkedin | email > linkedin_url > name+company_name |
| **Company** | name, regulatory_status, corridor_relevance, entity_type, geography, hubspot_company_id | name |
| **Deal** | hubspot_deal_id, name, stage, stage_id, pipeline, pipeline_id, amount, close_date, days_in_stage, last_activity, is_stale | hubspot_deal_id |
| **Interaction** | channel, type, direction, summary, subject, agent_name, timestamp, idempotency_key, session_id, is_archived, draft_approved | idempotency_key |
| **FollowUp** | due_date, type, status, description, hubspot_task_id | auto-generated ID |
| **Session** | session_id, started_at, ended_at, agent_name, skills_run, contacts_processed, interactions_logged, follow_ups_created, summary, is_archived | session_id |
| **Agent** | name, description, channels, capabilities, last_active, registered_at, paused | name |
| **AgentCapability** | name, channel, description | name+channel |
| **AgentMessage** | from_agent, to_agent, type, payload, status, created_at, read_at | auto-generated ID |
| **Memory** | key, content, tags, agent_name, contact_name, company_name, importance, expires_at | auto-generated ID |
| **Knowledge** | key, category, subcategory, title, content, tags, source_file, source_file_hash | key |

### Key Relationships

| Relationship | From | To | Created By |
|---|---|---|---|
| `WORKS_AT` | Contact | Company | upsert-contact (when company_name provided) |
| `BELONGS_TO` | Deal | Company | upsert-deal (when company_name provided) |
| `HAD_INTERACTION` | Contact | Interaction | log-interaction |
| `HAS_FOLLOW_UP` | Contact | FollowUp | create-follow-up |
| `TRIGGERED` | Interaction | FollowUp | create-follow-up (when interaction_id provided) |
| `LOGGED` | Session | Interaction | log-interaction (via session_id) |
| `REGISTERED_CAPABILITY` | Agent | AgentCapability | init-graph / register-agent |
| `ASSOCIATED_WITH` | Contact | Deal | link via contact_deal table (SQLite) |

## CLI Commands — Full Reference

### Infrastructure Commands

**health-check** — Test FalkorDB + SQLite + Apollo connectivity.
```bash
python scripts/state_manager.py health-check
# → {"falkordb": "OK", "sqlite": "OK", "apollo": "OK", "mode": "normal", ...}
```

**init-graph** — Create indices, SQLite tables, register default agents (outlook_triage, outlook_bd, linkedin_triage, linkedin_bd, scheduler).
```bash
python scripts/state_manager.py init-graph
# → {"falkordb": "OK", "sqlite": "OK", "indices_created": 33, "agents_registered": 5}
```

**register-agent** — Register a new agent or update an existing one.
```bash
python scripts/state_manager.py register-agent \
  --name "outlook_triage" \
  --description "Outlook inbox triage and reply drafting" \
  --channels "email" \
  --capabilities "inbox_triage,reply_drafting"
```

### Contact & Company Management

**upsert-contact** — Create or update a contact. Dedup priority: email > linkedin_url > name+company_name.
```bash
python scripts/state_manager.py upsert-contact \
  --name "Jane Smith" \
  --email "jane@examplebank.com" \
  --linkedin-url "https://linkedin.com/in/janesmith" \
  --title "Head of Payments" \
  --company-name "Example Bank" \
  --persona-lane "B" \
  --motion-type "FC" \
  --classification "HOT PROSPECT" \
  --hubspot-contact-id "12345" \
  --last-contacted "2026-03-09T10:00:00" \
  --last-channel "email" \
  --last-action "cold_outreach" \
  --linkedin-connection-status "connected" \
  --linkedin-connection-sent-at "2026-03-01T10:00:00"
```

**upsert-company** — Create or update a company (MERGE by name).
```bash
python scripts/state_manager.py upsert-company \
  --name "Example Bank" \
  --regulatory-status "licensed_psp" \
  --corridor-relevance "ASIAPAC" \
  --entity-type "bank" \
  --geography "Singapore" \
  --hubspot-company-id "67890"
```

**upsert-deal** — Sync a HubSpot deal (MERGE by hubspot_deal_id). Creates BELONGS_TO company.
```bash
python scripts/state_manager.py upsert-deal \
  --hubspot-deal-id "999" \
  --name "Example Bank - Pilot" \
  --stage "Qualification" \
  --stage-id "abc123" \
  --pipeline "BD Pipeline" \
  --pipeline-id "def456" \
  --amount 50000 \
  --close-date "2026-06-30" \
  --days-in-stage 12 \
  --last-activity "2026-03-01" \
  --is-stale \
  --company-name "Example Bank"
```

**check-contact** — Pre-draft dedup check. Returns `CLEAR`, `CAUTION` (contacted <3 days ago), or `DO_NOT_CONTACT`.
```bash
python scripts/state_manager.py check-contact \
  --email "jane@examplebank.com" \
  --channel "email"
# Also accepts: --name, --linkedin-url, --company-name
```

### Interaction Logging

**log-interaction** — Log an interaction with SHA256 idempotency protection.
```bash
python scripts/state_manager.py log-interaction \
  --contact-name "Jane Smith" \
  --email "jane@examplebank.com" \
  --company-name "Example Bank" \
  --channel "email" \
  --type "cold_outreach" \
  --direction "outbound" \
  --summary "Sent intro email about cross-border settlement" \
  --subject "Instant settlement for Example Bank" \
  --hubspot-note-id "note_123" \
  --session-id "session_20260309_outlook_bd" \
  --agent-name "outlook_bd" \
  --timestamp "2026-03-09T10:30:00" \
  --draft-approved
```

### Follow-Up Management

**create-follow-up** — Create a follow-up reminder linked to a contact and optionally an interaction.
```bash
python scripts/state_manager.py create-follow-up \
  --contact-name "Jane Smith" \
  --email "jane@examplebank.com" \
  --company-name "Example Bank" \
  --interaction-id 42 \
  --due-date "2026-03-12" \
  --type "email_follow_up" \
  --description "Follow up on intro email" \
  --hubspot-task-id "task_456"
```

**complete-follow-up** — Mark a follow-up as completed.
```bash
python scripts/state_manager.py complete-follow-up --id 7
```

**list-followups** — List follow-ups by status (default: pending). Overdue items are flagged.
```bash
python scripts/state_manager.py list-followups --status "pending" --limit 30
```

### Session Management

**log-session** — Log a session summary (INSERT OR REPLACE by session_id).
```bash
python scripts/state_manager.py log-session \
  --session-id "session_20260309_outlook_bd" \
  --started-at "2026-03-09T09:00:00" \
  --ended-at "2026-03-09T09:45:00" \
  --agent-name "outlook_bd" \
  --skills-run "outlook_bd" \
  --contacts-processed 8 \
  --interactions-logged 5 \
  --follow-ups-created 3 \
  --summary "Processed 8 contacts, sent 5 cold outreach emails, created 3 follow-ups"
```

**pre-session-check** — Comprehensive state dump: recently contacted, pending/overdue follow-ups, DNC list, unread agent messages, pending LinkedIn connections.
```bash
python scripts/state_manager.py pre-session-check --agent "outlook_bd"
```

### Agent Messaging

**post-message** — Send an inter-agent message.
```bash
python scripts/state_manager.py post-message \
  --from-agent "outlook_bd" \
  --to-agent "linkedin_bd" \
  --type "PROSPECT_SIGNAL" \
  --payload '{"contact": "Jane Smith", "company": "Example Bank", "signal": "replied to email, warm lead"}'
```

**get-messages** — Read unread messages addressed to an agent. Use `--mark-read` to mark them as read.
```bash
python scripts/state_manager.py get-messages --agent "linkedin_bd" --mark-read
```

### Memory System

**remember** — Store a learning or observation for future recall.
```bash
python scripts/state_manager.py remember \
  --key "jane_smith_prefers_whatsapp" \
  --content "Jane Smith mentioned she prefers WhatsApp for quick updates" \
  --tags "communication_preference,jane_smith" \
  --agent "outlook_triage" \
  --contact "Jane Smith" \
  --company "Example Bank" \
  --importance "high" \
  --expires-at "2026-06-09T00:00:00"
```

**recall** — Query memories by agent, contact, company, tags, or keyword. Sorted by importance (critical > high > normal) then recency.
```bash
python scripts/state_manager.py recall --agent "outlook_bd" --contact "Jane Smith" --limit 10
python scripts/state_manager.py recall --tags "communication_preference" --keyword "WhatsApp"
```

**forget** — Mark a memory as expired (soft delete).
```bash
python scripts/state_manager.py forget --id 15
```

### Knowledge System

**seed-knowledge** — Import markdown files from a directory into Knowledge nodes. Large files (>5K chars) are split by H2 headings.
```bash
python scripts/state_manager.py seed-knowledge \
  --source "shared_references" \
  --check-modified
# --rename "old_term:new_term,another_old:another_new" for term replacement during import
```

**query-knowledge** — Search Knowledge nodes by category, subcategory, tags, or keyword.
```bash
python scripts/state_manager.py query-knowledge --category "shared_references" --keyword "persona"
python scripts/state_manager.py query-knowledge --tags "compliance,outreach" --limit 5
```

### LinkedIn Connection Tracking

**check-pending-connections** — List connection requests sent >N days ago still pending.
```bash
python scripts/state_manager.py check-pending-connections --days 5
```

**update-connection-status** — Update a contact's LinkedIn connection status.
```bash
python scripts/state_manager.py update-connection-status \
  --linkedin-url "https://linkedin.com/in/janesmith" \
  --status "connected"
# Valid statuses: none, pending, connected, ignored, withdrawn
```

### Maintenance & Reporting

**archive-old** — Archive interactions and sessions older than N days (default 90). FalkorDB uses chunked 500/batch updates.
```bash
python scripts/state_manager.py archive-old --days 90
```

**graph-stats** — Return node/edge counts, timestamps, storage health, sync queue status.
```bash
python scripts/state_manager.py graph-stats
```

**sync-backup** — Replay pending sync_queue items to FalkorDB (used after FalkorDB downtime recovery).
```bash
python scripts/state_manager.py sync-backup
```

**generate-report** — Produce BD activity summary for daily or weekly period.
```bash
python scripts/state_manager.py generate-report --period "daily" --output "json"
# Output options: stdout (default), json (writes to /tmp/thegent-state/report.json), telegram
```

**generate-dnc-list** — Export DNC contacts to /tmp/thegent-state/dnc-list.json for sub-agent consumption.
```bash
python scripts/state_manager.py generate-dnc-list --channel "email"
# Channel options: email, linkedin, all (default)
```

## Failure Recovery — 3-Tier Degradation

The `health-check` command reports the current operating mode:

| Mode | FalkorDB | SQLite | Behaviour |
|---|---|---|---|
| **normal** | OK | OK | Dual-write to both stores. Full graph queries available. |
| **degraded** | DOWN | OK | All writes go to SQLite + sync_queue. Graph queries unavailable. Queued ops replay on recovery via `sync-backup`. |
| **degraded_no_sqlite** | OK | DOWN | FalkorDB only. No local backup. High risk — alert immediately. |
| **stateless** | DOWN | DOWN | No persistence. Skills should refuse to operate. |

**SQLite backup** is stored at `data/thegent_ops.db`. When FalkorDB is unavailable, write operations are queued in the `sync_queue` table and replayed when connectivity returns.

## Idempotency

`log-interaction` generates a SHA256 hash from `contact_id|channel|type|timestamp` (truncated to 32 chars). If a matching `idempotency_key` already exists, the insert is skipped and the response includes `"status": "skipped", "reason": "duplicate"`. This prevents double-logging when skills retry after timeouts.

## Contact Deduplication Priority

When looking up a contact, the system checks in this order:

1. **email** — exact match (highest priority)
2. **linkedin_url** — exact match
3. **name + company_name** — case-insensitive match (lowest priority)

The first match wins. On update, non-null fields are never overwritten with null (COALESCE pattern).
