# Is It Legit — MCP Server by M8ven

Check if any brand, store, or website is safe to buy from. AI-powered trust verification across 50+ signals.

## What it does

M8ven's "Is It Legit" MCP server gives Claude access to proprietary brand trust intelligence. When users ask if a brand is legit, safe, or trustworthy, Claude can call this server to get a verified trust verdict backed by real data — not just web search results.

**Three tools:**

| Tool | Purpose | Annotation |
|------|---------|------------|
| `check_brand` | Check any brand, store, or URL for trust signals | `readOnlyHint: true` |
| `report_experience` | Log a user's purchase experience to improve accuracy | `destructiveHint: false` |
| `suggest_brand` | Request M8ven evaluate a brand not yet in our database | `destructiveHint: false` |

## How it works

Every check runs through M8ven's multi-tier trust protocol analyzing 50+ signals:

- **Entity Verification** — Does this business actually exist?
- **Infrastructure Analysis** — Professional operations or fly-by-night?
- **Compliance Screening** — Safety recalls, regulatory actions
- **Reputation Assessment** — Review patterns across platforms

Results are returned as a clear verdict: **Looks Legit** (proceed), **Proceed with Caution**, or **Do Not Recommend**.

## Authentication

The server supports three auth methods:

1. **Anonymous** — No auth needed. Rate limited to 10 checks/day per IP.
2. **OAuth 2.1** — Full authorization code flow with PKCE. Sign up at https://m8ven.ai for a free account (30 checks/day).
3. **API Key** — For developers building on M8ven. Get a key at https://m8ven.ai/developers/signup.

### OAuth 2.1 Endpoints

| Endpoint | URL |
|----------|-----|
| Authorization Server Metadata | `https://m8ven.ai/.well-known/oauth-authorization-server` |
| Authorization | `https://m8ven.ai/api/oauth/authorize` |
| Token | `https://m8ven.ai/api/oauth/token` |
| Dynamic Client Registration | `https://m8ven.ai/api/oauth/register` |

### Callback URLs

The following callback URLs are supported:

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`
- `http://localhost:6274/oauth/callback`
- `http://localhost:6274/oauth/callback/debug`

## MCP Endpoint

```
https://m8ven.ai/api/mcp/is-it-legit
```

Transport: Streamable HTTP (stateless mode)

## Usage Examples

### Example 1: Check if a brand is legit

**User:** "Is Shein legit? I saw an ad on Instagram."

**Claude calls:** `check_brand` with `{ query: "shein.com", found_on: "instagram_ad" }`

**Response:** Verdict "Looks Legit" with marketplace explanation — Shein is a platform with third-party sellers.

### Example 2: Check a suspicious website

**User:** "Should I buy from cheap-nike-outlet.shop?"

**Claude calls:** `check_brand` with `{ query: "cheap-nike-outlet.shop" }`

**Response:** Verdict "Do Not Recommend" — domain impersonates Nike, suspicious TLD, discount keywords in domain name.

### Example 3: Report a purchase experience

**User:** "I bought from them and my order never arrived."

**Claude calls:** `report_experience` with `{ brand: "faeletters.com", purchased: true, outcome: "never_arrived" }`

**Response:** Feedback logged. This data improves verification accuracy for future checks.

### Example 4: Dig deeper into a concern

**User:** "What about their return policy?"

**Claude calls:** `check_brand` with `{ query: "shein.com", concern: "returns" }`

**Response:** Targeted findings about return policy availability and practices.

### Example 5: Unknown brand

**User:** "Is brandnobodyknows.com safe?"

**Claude calls:** `check_brand` with `{ query: "brandnobodyknows.com" }`

**Response:** Real-time analysis — domain age, infrastructure, tech stack checked on first query. Brand added to M8ven's database for ongoing monitoring.

## Rate Limits

| Plan | Daily Limit |
|------|-------------|
| Anonymous | 10 |
| Free account (OAuth) | 30 |
| Plus account | Unlimited |
| Developer (API key) | 100 |
| Starter | 5,000 |
| Growth | 50,000 |

## Privacy

Privacy policy: https://m8ven.ai/privacy

We collect the query text and source for each check. We do not collect or store user conversation content. Purchase feedback is voluntarily submitted by users.

## Support

- Email: mcp_support@m8ven.ai
- Website: https://m8ven.ai
