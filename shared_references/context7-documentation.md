# Context7 Documentation Review

Context7 provides live documentation access for key libraries used by the BD automation system. Every agent session should start with a documentation review to ensure the agent has current API context.

## Tool Names

| Step | Tool |
|---|---|
| 1. Resolve library ID | `mcp__plugin_compound-engineering_context7__resolve-library-id` |
| 2. Query documentation | `mcp__plugin_compound-engineering_context7__query-docs` |

## Two-Step Process

### Step 1 — Resolve Library ID

```
Tool: mcp__plugin_compound-engineering_context7__resolve-library-id
Input: { "libraryName": "falkordb python client" }
```

This returns the library ID and metadata. You only need to do this once per library — use the confirmed IDs below for subsequent queries.

### Step 2 — Query Documentation

```
Tool: mcp__plugin_compound-engineering_context7__query-docs
Input: { "context7CompatibleLibraryID": "/falkordb/falkordb-py", "topic": "graph queries MERGE upsert" }
```

## Confirmed Library IDs

| Library | Context7 ID | Snippets | Reputation |
|---|---|---|---|
| FalkorDB Python Client | `/falkordb/falkordb-py` | 174 | High |
| FalkorDB Docs | `/falkordb/docs` | 313 | -- |
| Apollo API | `/apolloio/apollo-api-docs` | -- | -- |

## Per-Agent Review Table

| Agent | FalkorDB Python Client | Apollo API | Review Mandatory? |
|---|---|---|---|
| `outlook_triage` | Yes | Yes | Both |
| `outlook_bd` | Yes | Yes | Both |
| `linkedin_triage` | Yes | No | FalkorDB only |
| `linkedin_bd` | Yes | No | FalkorDB only |

## Recommended Review Queries

### FalkorDB (all agents)

```
Topic: "graph queries MERGE upsert contact interaction"
```

This covers the core Cypher patterns used by state_manager.py — MERGE with ON CREATE/ON MATCH, COALESCE updates, relationship creation.

### Apollo (email agents)

```
Topic: "contacts search enrich create update notes tasks"
```

This covers the REST API endpoints for contact management, enrichment, notes, and task creation in Apollo.

## Notes

- Context7 snippet counts and library IDs are stable but may change if the upstream library is reorganized. If a query returns no results, re-run `resolve-library-id` to get the current ID.
- FalkorDB Docs (`/falkordb/docs`) covers the Cypher query language reference and is useful for complex graph queries beyond basic MERGE/MATCH patterns.
- Documentation reviews add latency to session start but prevent far more costly failures mid-session.
