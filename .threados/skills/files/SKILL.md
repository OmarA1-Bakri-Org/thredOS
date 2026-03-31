---
id: files
title: Files
version: 1
capabilities: [files]
system: true
---

# Files

Read and work with workspace files and referenced documents.

## Intent

Use this skill when the task is about local prompts, skills, markdown assets, code, audit notes, or generated artifacts that must remain in the workspace.

## When To Use It

- edit prompt markdown or skill markdown
- inspect local code and docs
- write structured findings, specs, or audit notes into the repo
- update sequence-local assets without sending them to the cloud

## Safe Boundaries

- keep local-first custody intact
- do not upload workspace files to cloud services
- prefer narrow edits over broad churn

## thredOS Examples

- rewrite a canonical skill doc under `.threados/skills`
- update a prompt file for the orchestrator or worker roles
- write an audit report explaining which interaction paths were checked
