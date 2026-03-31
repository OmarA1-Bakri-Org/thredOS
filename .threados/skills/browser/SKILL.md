---
id: browser
title: Browser
version: 1
capabilities: [browser]
system: true
---

# Browser

Navigate web pages and inspect interactive flows.

## Intent

Use the browser when a thread needs real page interaction, visual validation, or structured extraction from a website or local web app.

## When To Use It

- validate the thredOS surface in a running app
- inspect a docs site or SaaS dashboard
- capture screenshots of a broken flow
- confirm that a click path, redirect, or modal actually works

## Safe Boundaries

- do not paste local workspace content into third-party sites unless the user explicitly asked for it
- prefer read-only navigation and inspection unless the task requires mutation
- keep findings structured: page, action, observed result, expected result

## thredOS Examples

- check that clicking a node opens both on-surface cards and deep-links the correct side panel
- verify a browser auth redirect returns to the desktop activation flow
- inspect a docs page and return only the implementation-relevant findings
