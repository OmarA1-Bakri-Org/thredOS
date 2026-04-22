# Cross-Channel Intelligence Protocol

All BD-related skills (Outlook triage, Outlook BD, LinkedIn triage, LinkedIn BD) read from and write to a **shared intelligence file** at `/tmp/shared-intel/prospect-signals.json`. This coordinates outreach across email and LinkedIn to avoid double-touching contacts.

## What It Enables

- **Email → LinkedIn**: A prospect who replied to an email gets flagged so the LinkedIn agent avoids sending a redundant cold message and instead sends a warmer "great connecting via email" follow-up
- **LinkedIn → Email**: A HOT PROSPECT identified on LinkedIn gets flagged so the Outlook BD drafter can send a coordinated email follow-up (different channel, same thread of engagement)
- **Deduplication**: All agents check shared-intel before drafting to avoid contacting the same person through multiple channels in the same run window

## File Format

```json
{
  "generated_at": "2026-02-27T08:15:00Z",
  "generated_by": "skill-name-that-wrote-last",
  "prospects": [
    {
      "name": "Jane Smith",
      "company": "Example Bank",
      "email": "jane@example.com",
      "linkedin_url": "https://linkedin.com/in/janesmith",
      "channel": "email|linkedin",
      "classification": "HOT PROSPECT",
      "last_action": "replied to outreach",
      "last_action_date": "2026-02-27",
      "suggested_next": "follow up on LinkedIn with meeting confirmation",
      "do_not_contact_via": []
    }
  ]
}
```

## Rules

1. Each skill **APPENDS** to the prospects array — never overwrites existing entries from other skills
2. Check `generated_at` — if the file is older than **24 hours**, treat it as stale and start fresh
3. The `do_not_contact_via` array prevents cross-channel spam (e.g., `["linkedin"]` means don't message on LinkedIn, email is fine)
4. If the shared-intel file doesn't exist, proceed without it — cross-channel communication is additive, not required
5. Always set `channel` to the channel through which the prospect was identified
6. Always set `generated_by` to your skill's name when writing

## Directory Setup

```bash
mkdir -p /tmp/shared-intel
```

The `/tmp/shared-intel/` directory should NEVER be deleted by any individual skill — other skills may still need it.

---

## FalkorDB-Backed Cross-Channel Intelligence

The shared JSON file approach above is supplemented (and largely replaced) by **FalkorDB graph state** as the persistent backend for cross-channel intelligence. FalkorDB provides durable, queryable state that survives session restarts and machine reboots — unlike temp files.

### What Changed

- **Before**: Cross-channel signals were written to `/tmp/shared-intel/prospect-signals.json`. This file was ephemeral (lost on reboot), required manual staleness checks, and had no dedup protection.
- **Now**: All cross-channel intelligence is stored in the FalkorDB graph (with SQLite backup) via `scripts/state_manager.py`. The temp file may still be used as a fast-access cache, but the graph is the source of truth.

### Agent Messages as Coordination Mechanism

Inter-agent coordination now uses **agent messages** stored in the graph. Each message has a type that signals intent:

| Message Type | Purpose | Example |
|---|---|---|
| `PROSPECT_SIGNAL` | Flag a prospect as engaged on one channel so the other channel can act | outlook_bd tells linkedin_bd that Jane Smith replied to a cold email |
| `DO_NOT_CONTACT` | Block outreach to a contact on a specific channel | linkedin_triage tells outlook_bd that a prospect asked to stop receiving messages |
| `FOLLOW_UP_REQUEST` | Request the other channel to follow up with a contact | outlook_bd asks linkedin_bd to send a connection request to a warm email lead |
| `TASK_HANDOFF` | Transfer ownership of a task or contact to another agent | linkedin_bd hands off a meeting-ready prospect to outlook_bd for calendar scheduling |
| `STATUS_UPDATE` | General status broadcast (session summary, pipeline changes) | scheduler sends daily pipeline summary to all agents |

### Posting an Agent Message

```bash
python scripts/state_manager.py post-message \
  --from-agent "outlook_bd" \
  --to-agent "linkedin_bd" \
  --type "PROSPECT_SIGNAL" \
  --payload '{"contact": "Jane Smith", "company": "Example Bank", "email": "jane@examplebank.com", "signal": "replied to cold email — warm lead, interested in ASIAPAC corridors", "suggested_action": "send LinkedIn connection request with warm note referencing email thread"}'
```

### Reading Agent Messages

Every agent reads its messages at session start (Step 0 of cadence-procedures.md):

```bash
python scripts/state_manager.py get-messages --agent "linkedin_bd" --mark-read
```

Response format:
```json
{
  "messages": [
    {
      "id": 1,
      "from_agent": "outlook_bd",
      "to_agent": "linkedin_bd",
      "type": "PROSPECT_SIGNAL",
      "payload": "{\"contact\": \"Jane Smith\", ...}",
      "status": "unread",
      "created_at": "2026-03-09T10:30:00"
    }
  ],
  "count": 1
}
```

The `--mark-read` flag marks messages as read after retrieval so they are not processed again in the next session.

### Cross-Channel Workflow (FalkorDB)

**Email-to-LinkedIn handoff:**
1. outlook_triage classifies a reply as HOT PROSPECT
2. outlook_triage posts a `PROSPECT_SIGNAL` message to `linkedin_bd`
3. linkedin_bd reads the message at session start
4. linkedin_bd runs `check-contact` to see if the contact exists and is clear to contact
5. linkedin_bd sends a warm connection request referencing the email thread

**LinkedIn-to-Email handoff:**
1. linkedin_triage detects a positive reply in inbox scraper results
2. linkedin_triage posts a `PROSPECT_SIGNAL` message to `outlook_bd`
3. outlook_bd reads the message and sends a coordinated email follow-up

**Do-Not-Contact propagation:**
1. Any agent receives an unsubscribe/opt-out signal
2. Agent posts a `DO_NOT_CONTACT` message to all other agents
3. Agent updates the contact record: `upsert-contact --email "X" --do-not-contact-email 1` (or equivalent for LinkedIn)
4. Receiving agents process the message and add the contact to their skip lists

### Deduplication via Graph

Instead of checking a JSON file's `generated_at` timestamp, agents now use `check-contact` which queries the graph for:
- Recent interactions (last 3 days triggers `CAUTION`)
- DNC flags on the contact node
- Last channel and action

This is more reliable than file-based dedup because the graph state is persistent and consistent across all agents.
