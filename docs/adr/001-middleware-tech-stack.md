# ADR-001: Enrichment Middleware Tech Stack

## Status
Accepted

## Context
We need a lightweight middleware service (`ats-enrichment-service`) that sits between OpenCATS (PHP) and Clay.com's API. Its responsibilities are:
- Protect API keys from the frontend
- Centralize rate limiting
- Normalize provider responses
- Enable future multi-provider waterfall

Options considered:
1. **Node.js + Express** — lightweight, excellent async HTTP support, fast cold starts
2. **Python + FastAPI** — good async, auto-generated docs, strong data validation with Pydantic
3. **PHP (within OpenCATS)** — no separate service, but couples tightly to OpenCATS

## Decision
**Node.js + Express**

## Rationale
- Simple async HTTP proxying is Express's sweet spot
- `express-rate-limit` provides plug-and-play rate limiting
- Easy Docker packaging for sidecar deployment
- No heavy framework needed — the service has a single endpoint
- Separates concerns cleanly from the PHP codebase
- Team familiarity with JavaScript/Node ecosystem

## Consequences
- Requires Node.js 20+ in CI and production
- Adds a Docker service to the deployment stack
- PHP module communicates with middleware over HTTP (adds ~1-5ms local latency)
