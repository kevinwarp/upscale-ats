# upscale-ats

Candidate email enrichment module for OpenCATS — powered by Clay.com API.

## Overview

Adds an **"Enrich Personal Email"** action to OpenCATS candidate profiles that calls Clay.com to find personal email addresses, stores results with confidence scores and provenance, and enforces rate limits, cooldowns, and overwrite-prevention rules.

## Architecture

```
┌──────────────┐      HTTP/JSON       ┌─────────────────────┐      HTTPS       ┌───────────┐
│   OpenCATS   │ ──────────────────── │  enrichment-service │ ──────────────── │  Clay.com │
│  (PHP module)│                      │  (Node.js/Express)  │                  │    API    │
└──────────────┘                      └─────────────────────┘                  └───────────┘
       │                                       │
       └──────── MySQL (shared) ───────────────┘
```

## Repo Structure

```
upscale-ats/
├── opencats-module/         # PHP module for OpenCATS
│   ├── migrations/          # SQL schema migrations
│   ├── src/
│   │   ├── Actions/         # API action handlers
│   │   ├── Helpers/         # Config, activity logging
│   │   ├── Models/          # Candidate enrichment DAO
│   │   └── Views/           # UI templates
│   └── tests/               # PHPUnit tests
├── enrichment-service/      # Node.js middleware
│   ├── src/
│   │   ├── middleware/      # Auth, rate limiting, validation
│   │   ├── routes/          # Express route handlers
│   │   ├── services/        # Clay API client
│   │   └── utils/           # Logger
│   └── tests/               # Jest tests (unit + integration)
├── docs/                    # TRD, ADRs, runbooks
├── .github/workflows/       # CI pipeline
├── docker-compose.yml       # Local dev environment
└── .env.example             # Environment variable template
```

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/kevinwarp/upscale-ats.git
cd upscale-ats
cp .env.example .env
# Edit .env with your Clay API key and other secrets

# 2. Start services
docker compose up -d

# 3. Run enrichment service tests
cd enrichment-service && npm install && npm test

# 4. Run PHP tests
cd ../opencats-module && phpunit tests/
```

## Key Features

- **Single-click enrichment** on candidate profile pages
- **Write protection**: never overwrites verified emails; confidence-based overwrite for unverified
- **Rate limiting**: per-user (60/day), global (500/day), per-candidate cooldown (7 days)
- **Audit logging**: every enrichment attempt logged with user, result, confidence, timestamp
- **Security**: API keys in env vars only, never in DB; Bearer token auth between services
- **Extensible**: middleware supports future multi-provider waterfall (Apollo, Hunter, etc.)

## License

Proprietary — internal use only.
