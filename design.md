# Design Decisions - Mini Crawler

## Architectural Overview

This project implements a distributed web crawling system with the following components:
- **API**: Express.js REST API serving both API endpoints and static frontend
- **Worker**: Node.js worker consuming RabbitMQ messages and processing crawls
- **Frontend**: Vue 3 SPA for user interaction
- **MongoDB**: Document storage for crawl results
- **RabbitMQ**: Message queue for asynchronous job processing

## Key Design Decisions

### 1. Image Storage Strategy

**Decision: Store images directly as Buffer in MongoDB documents**

**Rationale:**
- **Simplicity**: No need to manage GridFS chunks and files collections
- **Performance**: Single document lookup to retrieve all crawl data including image
- **Size**: JPEG quality 50 with typical full-page screenshots results in 200-800KB images, well within MongoDB's 16MB document limit
- **Trade-off**: For very long pages (>5000px), images might approach 1-2MB, still acceptable

**Alternative Considered:**
- GridFS: Better for very large images (>2MB) but adds complexity with separate collections and additional queries
- External storage (S3): Overkill for this use case, adds external dependency and cost

**Failure Mode:**
- If a page generates a screenshot >16MB (extremely rare), the worker will fail with a MongoDB document size error
- Mitigation: Could add screenshot height limit or quality adjustment based on page height

### 2. Idempotency Implementation

**Decision: 5-minute window with URL+status lookup**

**Mechanism:**
- On POST /crawl, check if the same normalized URL exists with status="pending" within last 5 minutes
- If yes, return existing UID without creating new job
- If no, create new job with fresh UID

**Rationale:**
- Prevents duplicate processing of same URL in quick succession
- 5-minute window balances between preventing duplicates and allowing re-crawls after failures
- Simple to implement with single MongoDB query using compound index

**Edge Cases Handled:**
- URL normalization (remove fragments, lowercase domain)
- Concurrent requests: MongoDB unique constraint on UID prevents race conditions
- Failed jobs: After 5 minutes, URL can be re-crawled

### 3. RabbitMQ Retry Strategy

**Decision: Max 2 retries with dead-letter queue**

**Implementation:**
- Worker nacks messages on failure
- RabbitMQ tracks delivery count via x-delivery-count header
- After 2 failed attempts, message sent to dead-letter queue
- Worker updates MongoDB with error status on each failure

**Rationale:**
- Transient failures (network blips, temporary browser issues) benefit from retry
- 2 retries balance recovery vs. resource waste
- DLQ allows manual inspection of persistent failures
- MongoDB always updated so API returns error status even if worker crashes

**Failure Modes Covered:**
- Browser crash: Retried up to 2 times
- Network timeout: Retried
- robots.txt block: Immediately marked as error (no retry)
- OpenAI API failure: Retried (may succeed if temporary outage)

### 4. Timeout Strategy

**Decision: 30-second hard timeout per page with fallback**

**Implementation:**
```typescript
// Primary: Wait for network idle (10s timeout)
await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });

// Fallback: Use domcontentloaded if networkidle fails
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
```

**Rationale:**
- SPAs and heavy sites may never reach "networkidle"
- 10-second networkidle is reasonable for most sites
- Fallback to domcontentloaded ensures we get *something*
- 30-second total timeout prevents indefinite blocking

**Trade-offs:**
- Fast fallback may capture incomplete SPAs
- Alternative: Could wait fixed time (e.g., 3s) after domcontentloaded
- Chose simpler approach for MVP

### 5. Robots.txt Compliance

**Decision: Best-effort robots.txt parsing with lenient defaults**

**Implementation:**
- Fetch /robots.txt with 5-second timeout
- Parse using robots-parser library
- Check User-agent: * rules
- On any error (404, timeout, parse error): **allow crawling**

**Rationale:**
- Demonstrates respect for robots.txt without being overly strict
- Many sites don't have robots.txt or have misconfigured ones
- Lenient defaults prevent false negatives
- Timeout prevents slow robots.txt from blocking workers

**Ethical Considerations:**
- This is a demo/research project, not production crawler
- User-agent identifies as bot: "CrawlerBot/1.0"
- Respects explicit disallow rules
- Could add configurable user-agent override if needed

### 6. OpenAI Vision Integration

**Decision: GPT-4 Vision with base64-encoded images**

**Prompt Strategy:**
```
"Descrivi layout, gerarchia visiva, palette, tipografia, pattern UI, densità contenuti. 
Evita contenuti testuali del sito; concentrati su design e UX."
```

**Rationale:**
- GPT-4 Vision excels at visual analysis
- Base64 inline encoding simplifies integration (no need to upload images)
- Focused prompt produces consistent, design-oriented descriptions
- 500 token limit balances detail vs. cost

**Mock Mode:**
- `OPENAI_MOCK=1` returns canned response for testing without API costs
- Useful for development and CI/CD

**Cost Consideration:**
- ~$0.01-0.02 per image with GPT-4 Vision
- For production: Could add caching layer or use GPT-4o-mini

### 7. Rate Limiting

**Decision: 10 requests/minute per IP**

**Implementation:**
- express-rate-limit middleware
- Sliding window algorithm
- Per-IP tracking

**Rationale:**
- Prevents abuse without hindering legitimate use
- 10/min allows testing multiple URLs quickly
- Could be made configurable via env var for production

**Alternative Considered:**
- Per-user API keys: Overkill for demo project
- Global rate limit: Less fair, single user could block others

### 8. Frontend Polling Strategy

**Decision: Exponential backoff from 2s to 30s max**

**Implementation:**
```typescript
let delay = 2000;  // Start at 2s
delay = Math.min(delay * 1.5, 30000);  // Increase by 1.5x, cap at 30s
```

**Rationale:**
- 2-second initial poll: Fast feedback for quick crawls
- Exponential backoff: Reduces server load for slow crawls
- 30-second cap: Prevents excessive delays
- Max 30 attempts: Reasonable timeout (2-3 minutes total)

**User Experience:**
- Shows elapsed time during polling
- Blocking loader prevents multiple simultaneous requests
- Clear error messages on timeout or failure

## Security Considerations

### Input Validation
- URL parsing with built-in URL class
- Protocol whitelist (http/https only)
- Reject data: and file: URIs
- Fragment removal (potential XSS vector)

### Docker Security
- Non-root user in containers (could be added for production)
- No host volume mounts in production containers
- Separate network for services (default bridge)

### API Security
- Request ID tracking for audit logs
- Rate limiting per IP
- Helmet.js security headers
- CORS enabled (would restrict in production)

## Performance Optimizations

### Database Indexes
```javascript
{ uid: 1 }              // Unique index for lookups
{ url: 1, status: 1 }   // Compound index for idempotency check
{ createdAt: -1 }       // Index for time-based queries
```

### RabbitMQ Tuning
- Prefetch: 1 (prevents worker overload)
- Persistent messages (survive broker restart)
- Durable queues (survive broker restart)

### Browser Optimization
- Headless mode (no GUI overhead)
- JPEG quality 50 (good balance)
- Single browser instance per worker (could pool for scale)

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| MongoDB down | Health check fails | API returns 503, worker crashes (restart) |
| RabbitMQ down | Health check fails | API returns 503, worker crashes (restart) |
| Worker crash | Message not acked | RabbitMQ redelivers to another worker |
| Browser timeout | 30s timeout | Mark as error, retry up to 2x |
| OpenAI API down | API error | Retry up to 2x, then mark as error |
| Network partition | Connection timeout | Worker retries, then DLQ |
| Disk full | MongoDB write error | Worker marks as error |

## Testing Strategy

### E2E Tests
- Multiple URL types (standard, SPA, robots.txt blocked)
- Idempotency verification
- Error handling validation
- Timeout scenarios

### Manual Testing Checklist
1. Submit valid URL → Success with screenshot
2. Submit invalid URL → 400 error
3. Submit same URL twice → Same UID
4. Submit URL blocked by robots.txt → Error message
5. Submit very slow-loading page → Eventually completes or times out
6. Check RabbitMQ UI → Messages flowing correctly
7. Check MongoDB → Documents created with correct structure

## Future Enhancements

1. **Caching Layer**: Redis cache for repeated URLs within 24h
2. **Webhook Notifications**: Instead of polling, push updates via webhooks
3. **Batch Processing**: Submit multiple URLs at once
4. **Historical Tracking**: Keep history of crawls for same URL
5. **Configurable Quality**: Let user choose screenshot quality/size
6. **PDF Export**: Generate PDF report of analysis
7. **Comparison Mode**: Compare two websites side-by-side
8. **Scheduling**: Periodic re-crawls to track design changes

## Conclusion

This architecture prioritizes:
- **Simplicity**: Straightforward implementations over clever abstractions
- **Reliability**: Multiple retry layers and graceful degradation
- **Observability**: Logging, health checks, and request tracking
- **Scalability**: Horizontal scaling of workers via Docker Compose replicas
- **Maintainability**: Clear separation of concerns, TypeScript type safety

The design is production-ready for moderate load (<1000 req/day) with minor tweaks (auth, better monitoring, resource limits).
