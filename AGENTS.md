# AGENTS.md — Sift (Amazon Review Analyzer Chrome Extension)

> **⚠️ LLM Entry Point**: This file is the primary context document for all AI/LLM interactions with this codebase. Read this file FIRST before making any changes. Update this file whenever the architecture, flows, or infrastructure change.

## Overview

Sift is a Chrome extension (Manifest V3) that uses AI to analyze Amazon product reviews. It provides free-tier analysis (pros/cons, sentiment, summary, fake detection, category highlights) and premium features ($3.49 AUD/mo via Stripe) including AI chat, price history, product comparison with verdict, and export.

## Tech Stack

- **Extension**: Chrome Manifest V3, vanilla JavaScript (no framework)
- **Backend**: Go (stdlib net/http), no framework
- **Database**: PostgreSQL (via github.com/lib/pq)
- **AI**: Google Gemini 2.5 Flash (via github.com/google/generative-ai-go)
- **Payments**: Stripe (via github.com/stripe/stripe-go/v82)
- **Auth**: Google OAuth 2.0 + JWT (via github.com/golang-jwt/jwt/v5)

## Project Structure

```
sift/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic (auth, analysis, chat, compare, export)
├── popup.css              # Styling (dark/light theme, Apple-inspired)
├── config.js              # Environment config (API_BASE, GOOGLE_CLIENT_ID)
├── content.js             # Content script (scrapes Amazon product pages)
├── build.sh               # Production build script (creates dist/ with prod config)
├── AGENTS.md              # This file
├── README.md              # Project documentation
├── TODO.md                # Task tracking
│
├── dist/                  # Production build output (gitignored)
│   ├── sift-extension.zip # Ready-to-upload Chrome Web Store zip
│   └── ...                # Unpacked extension files with prod config
│
└── backend/
    ├── main.go            # HTTP server entry point (:8080)
    ├── go.mod             # Go module definition (go 1.25.0)
    ├── .env               # Environment variables (gitignored)
    ├── dev.sh             # Dev startup script (Go + Stripe listener)
    │
    ├── models/
    │   ├── types.go       # Request/response types (Review, AnalyzeRequest, ChatRequest, etc.)
    │   └── user.go        # User model (User, AuthRequest, AuthResponse)
    │
    ├── services/
    │   ├── gemini.go      # Gemini AI integration (AnalyzeReviews, Chat)
    │   ├── db.go          # PostgreSQL database (InitDB, user CRUD, rate limiting)
    │   ├── auth.go        # Google OAuth verification, JWT generation/validation
    │   └── stripe.go      # Stripe checkout, portal, webhook handling
    │
    ├── handlers/
    │   ├── analyze.go     # POST /api/analyze, GET /api/analyze/remaining
    │   ├── auth.go        # POST /api/auth/google, GET /api/auth/me
    │   ├── chat.go        # POST /api/chat (premium only)
    │   └── stripe.go      # Stripe checkout, portal, webhook handlers
    │
    └── middleware/
        ├── cors.go        # CORS middleware (configurable via CORS_ALLOWED_ORIGIN)
        └── auth.go        # JWT extraction helper (GetUserFromRequest)
```

## Environment Variables

### Backend (.env)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Google Gemini API key |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_test_... or sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (whsec_...) |
| `STRIPE_PRICE_ID` | Stripe price ID for $3.49 AUD/mo plan (price_...) |
| `JWT_SECRET` | Secret for signing/verifying JWTs (defaults to "sift-dev-secret" if unset) |
| `CORS_ALLOWED_ORIGIN` | (Production only) Restrict CORS to a specific extension origin. If unset, dev mode allows chrome-extension:// and localhost |

### Extension (config.js)

| Constant | Dev Default | Production |
|----------|-------------|------------|
| `CONFIG.API_BASE` | `http://localhost:8080` | Your production API URL (HTTPS) |
| `CONFIG.GOOGLE_CLIENT_ID` | Dev OAuth client ID | Production OAuth client ID |

## API Routes

| Method | Path | Auth | Tier | Description |
|--------|------|------|------|-------------|
| GET | /api/health | No | — | Health check |
| POST | /api/analyze | Optional | Free (5/day) | Analyze product reviews |
| GET | /api/analyze/remaining | Optional | — | Get remaining free-tier analyses |
| POST | /api/chat | JWT | Premium | Chat about product (full page context) |
| POST | /api/auth/google | No | — | Exchange Google access token for JWT |
| GET | /api/auth/me | JWT | — | Get current user info |
| POST | /api/stripe/create-checkout | JWT | — | Create Stripe checkout session |
| POST | /api/stripe/create-portal | JWT | — | Create Stripe billing portal |
| POST | /api/stripe/webhook | Stripe sig | — | Handle Stripe events |

## Key Flows

### Analysis Flow (Free Tier)
1. User clicks "Analyze Reviews" in popup
2. popup.js sends `scrapeReviews` message to content.js
3. content.js scrapes reviews from DOM (`[data-hook="review"]` elements)
4. If no reviews found, shows error toast and does NOT count against rate limit
5. popup.js sends reviews + productName to `POST /api/analyze`
6. Backend checks rate limit (5/24h rolling window by IP for free users, unlimited for premium)
7. Backend sends reviews to Gemini 2.5 Flash with structured JSON prompt (temperature 0.3)
8. Gemini returns analysis (summary, pros, cons, sentiment, fake flags, category highlights)
9. Analysis logged to `analysis_logs` only after successful Gemini response
10. Results rendered in popup, cached in `chrome.storage.local` (1hr expiry, keyed by ASIN)
11. Remaining analyses badge updated from response

### Auth Flow
1. User clicks "Sign in with Google"
2. popup.js uses `chrome.identity.launchWebAuthFlow` (implicit OAuth flow, `response_type=token`)
3. Google returns access_token in redirect URL hash
4. popup.js sends token to `POST /api/auth/google`
5. Backend calls Google userinfo API (`/oauth2/v2/userinfo`) to verify token
6. Backend creates/finds user in PostgreSQL by google_id
7. Backend generates JWT (30-day expiry, HS256) and returns with user info
8. JWT stored in `chrome.storage.local` as `kp_token`, user info as `kp_user`
9. On popup open, `GET /api/auth/me` is called to refresh user state

### Premium Chat Flow
1. User types question in chat input
2. popup.js scrapes full product page (`scrapeProductPage` action) for context (lazy-loaded, cached in memory)
3. Sends reviews + productDetails + productName + question to `POST /api/chat`
4. Backend verifies JWT + premium status (returns 402 if not premium)
5. Gemini receives full product context (features, specs, description, reviews, price) with anti-hallucination rules (temperature 0.5)
6. Response shown in chat bubble, messages persisted in `chrome.storage.local` keyed by ASIN

### Stripe Subscription Flow
1. User clicks "Upgrade - $3.49/mo"
2. popup.js sends current tab URL (returnUrl) + JWT to `POST /api/stripe/create-checkout`
3. Backend searches for existing Stripe customer by email, creates one if not found
4. Backend checks for existing active subscription (prevents duplicates, returns 409 Conflict)
5. Creates Stripe checkout session with `client_reference_id` set to user ID, returns URL
6. User completes payment on Stripe hosted checkout
7. Stripe sends `checkout.session.completed` webhook → backend sets `stripe_customer_id` and `is_premium = true`
8. Redirect back to the Amazon page user was on (success/cancel URLs both point to returnUrl)
9. Cancellation: `customer.subscription.deleted` webhook → sets `is_premium = false`
10. Payment failure: `invoice.payment_failed` webhook → sets `is_premium = false`

### Compare Flow
1. User saves products for comparison (max 5) from analysis results
2. Selects 2 products in compare view (cards are clickable, white border on selection)
3. Same-product comparison is blocked (checked by ASIN)
4. Side-by-side comparison shows pros, cons, sentiment for each product
5. **Final Verdict** section below shows winner (🏆) or toss-up (🤝) based on sentiment scores

### Data Caching Strategy
- **Analysis results**: `chrome.storage.local`, keyed by `kp_cache_{ASIN}`, 1-hour expiry (3600000ms)
- **Chat messages**: `chrome.storage.local`, keyed by `kp_chat_{ASIN}`, no expiry
- **Auth**: JWT as `kp_token`, user info as `kp_user` in `chrome.storage.local`
- **Theme preference**: `chrome.storage.local` key `kp_theme` (values: "dark" or "light")
- **Saved comparisons**: `chrome.storage.local` key `kp_comparisons` (max 5 products)

## Database Schema

### users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated via `uuid_generate_v4()` |
| email | TEXT NOT NULL | Google email |
| name | TEXT NOT NULL | Google display name |
| google_id | TEXT UNIQUE NOT NULL | Google user ID |
| stripe_customer_id | TEXT DEFAULT '' | Stripe customer ID |
| is_premium | BOOLEAN DEFAULT FALSE | Premium subscription status |
| created_at | TIMESTAMPTZ NOT NULL | Account creation time |

### analysis_logs
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated via `uuid_generate_v4()` |
| ip_address | TEXT NOT NULL | Client IP for rate limiting |
| user_id | UUID (nullable) | User ID if logged in |
| created_at | TIMESTAMPTZ DEFAULT NOW() | Analysis timestamp |

Index: `idx_analysis_logs_ip_created` on `(ip_address, created_at)`

Tables and index are auto-created in `services.InitDB()` with `CREATE TABLE IF NOT EXISTS`.

## Content Script Scraping

The content script (`content.js`) runs on Amazon product pages (`.com`, `.co.uk`, `.ca`, `.com.au`):

- **scrapeProductName()**: `#productTitle`
- **scrapeReviews()**: `[data-hook="review"]` elements → title, body, rating (parsed from star rating text), verified (via `avp-badge`)
- **scrapeASIN()**: URL pattern `/dp/{ASIN}` or `/gp/product/{ASIN}`, fallback `input[name="ASIN"]`
- **scrapePrice()**: `.a-price .a-offscreen`, fallbacks `#priceblock_ourprice`, `#priceblock_dealprice`, `.a-price-whole`
- **scrapeImage()**: `#landingImage`, fallback `#imgBlkFront`
- **scrapeProductDetails()**: Feature bullets, product description, specs/detail table, A+ content (truncated to 2000 chars), overall rating, total review count

Two message actions:
- `scrapeReviews`: Returns `{ productName, reviews, asin, price, image }`
- `scrapeProductPage`: Returns all above + `productDetails` (for chat context)

## Premium Features (require login + active Stripe subscription)
1. **AI Chat**: Ask questions about the full product page (grounded in provided data, anti-hallucination rules)
2. **Price History**: CamelCamelCamel chart embedded via ASIN (supports US and AU domains)
3. **Compare Mode**: Save up to 5 products, select 2 for side-by-side comparison with final verdict
4. **Export**: Copy to clipboard or download `.txt` report

## Free Tier Limits
- 5 analyses per rolling 24-hour window (tracked by IP via `analysis_logs` table)
- Only successful analyses count (failed/no-reviews attempts are not logged)
- Remaining count shown via badge on popup load (fetched from `GET /api/analyze/remaining`)
- Premium users: unlimited analyses (remaining count returns -1, badge hidden)

## UI Features
- Dark/light theme toggle (persisted via `kp_theme`)
- Haptic button feedback (`scale(0.97)` on `:active`)
- Toast notifications (auto-dismiss after 3s, supports info/success/error types, colored correctly in light mode)
- Analysis caching (results persist per product when popup reopens)
- Persistent chat (messages saved per product ASIN)
- Typing indicator (animated dots) during chat responses
- Sentiment summary (1-3 sentence AI-generated overview below sentiment bar)
- Apple-inspired design (SF Pro font stack, 14px border-radius cards, gradient buttons)
- 440px popup width

## Development & Production

### Development Setup

```bash
# Prerequisites: Go 1.25+, PostgreSQL, Stripe CLI

# Database
createdb sift

# Backend
cd backend
# Create .env with required variables (DATABASE_URL, GEMINI_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, JWT_SECRET)
# Do NOT set CORS_ALLOWED_ORIGIN in dev (enables dev mode CORS)
./dev.sh              # Starts Go server + Stripe webhook listener

# Extension
# chrome://extensions → Developer mode → Load unpacked → select project root
# config.js has dev defaults (localhost:8080)
```

### Production Build

```bash
# Build extension zip with production config
./build.sh --api https://your-api.com --client-id YOUR_PROD_GOOGLE_CLIENT_ID

# Output: dist/sift-extension.zip (upload to Chrome Web Store)
# Or use env vars: PROD_API_BASE and PROD_GOOGLE_CLIENT_ID
```

### Production Backend Checklist
- Set `CORS_ALLOWED_ORIGIN=chrome-extension://YOUR_EXTENSION_ID` (locks CORS to your published extension)
- Set `JWT_SECRET` to a strong random secret (do NOT use the dev fallback)
- Use Stripe live keys (`sk_live_...`) instead of test keys
- Ensure HTTPS on the API domain
- Set all 7 env vars in production

## Important Notes for LLMs

- **Storage keys** use `kp_` prefix: `kp_token`, `kp_user`, `kp_theme`, `kp_cache_{ASIN}`, `kp_chat_{ASIN}`, `kp_comparisons`
- **Go module** is `github.com/scoogii/keypoints-backend`
- **Config** is in `config.js` (loaded before `popup.js`) — use `CONFIG.API_BASE` and `CONFIG.GOOGLE_CLIENT_ID`
- **CORS** is configurable: set `CORS_ALLOWED_ORIGIN` env var for production, unset for dev mode
- **Gemini prompts** have strict anti-hallucination rules — do not remove them
- **Stripe webhook** uses `IgnoreAPIVersionMismatch: true` due to SDK/API version differences
- **UUID**: User IDs and log IDs are PostgreSQL UUID type via `uuid-ossp` extension; empty `user_id` inserts as NULL
- **Rate limiting**: By IP using `analysis_logs` table with 24-hour rolling window; `X-Forwarded-For` header is respected; only successful analyses are counted
- **JWT fallback secret**: If `JWT_SECRET` env var is empty, defaults to `"sift-dev-secret"` — must be set in production
- **Compare is client-side only**: Product comparison does not use AI — it renders saved analysis data side-by-side with an auto-generated verdict
- **Same-product comparison** is blocked by ASIN check
- **Build outputs** go to `dist/` (gitignored) — never edit files in dist directly
