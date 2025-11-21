# Mini Crawler - Fullstack Developer Research Q4 2025

## Project Structure

This is a complete implementation of the Mini Crawler project as specified. The repository contains:

```
/app
  /api          - Express.js API + static server
  /web          - Vue 3 + TypeScript frontend
  /worker       - Playwright-based crawler worker
  /scripts      - E2E test scripts
  docker-compose.yml
  Dockerfile.api
  Dockerfile.worker
  package.json   - Root workspace configuration
  design.md      - Architecture and design decisions
  .env           - Environment variables
```

## Quick Start

1. **Build the frontend**:
   ```bash
   cd app
   yarn build-frontend
   ```

2. **Start the stack**:
   ```bash
   docker compose up --build
   ```

3. **Access the application**:
   - Frontend: http://localhost:8080
   - RabbitMQ UI: http://localhost:15672 (guest/guest)
   - API Health: http://localhost:8080/healthz

## Running Tests

```bash
cd app
yarn test:e2e
```

This will:
- Start the Docker stack if not running
- Test multiple URLs including robots.txt validation
- Verify idempotency
- Provide detailed test output

## Implementation Notes

### Features Implemented

✅ **API (Express)**
- POST /crawl with URL validation and normalization
- GET /crawl/:uid for status polling
- Rate limiting (10 req/min per IP)
- Health check endpoint
- Static file serving
- Request ID tracking
- Idempotency (5-minute window)

✅ **Worker (Node + Playwright)**
- RabbitMQ consumer with prefetch=1
- Playwright browser automation
- Full-page JPEG screenshots (quality 50)
- robots.txt compliance checking
- OpenAI Vision integration for design analysis
- Retry logic (max 2 retries)
- Dead-letter queue for failed messages
- Proper timeout handling (30s hard limit)
- SPA support with networkidle fallback

✅ **Frontend (Vue 3 + TypeScript)**
- URL input with real-time validation
- Responsive design
- Polling with exponential backoff (2s to 30s)
- Loading states with progress indicator
- Error handling with retry option
- Screenshot and description display

✅ **Infrastructure**
- Docker Compose orchestration
- MongoDB with proper indexes
- RabbitMQ with dead-letter exchange
- Health checks for all services
- Multi-stage builds for optimization

✅ **Edge Cases Handled**
- URL redirects (follows to final destination)
- SPAs with delayed rendering
- robots.txt compliance
- Basic auth detection
- TLS certificate errors
- Concurrent requests (idempotency)
- Very long pages (fullPage: true)

### Design Decisions

See `design.md` for detailed explanations of:
- Image storage strategy (Buffer vs GridFS)
- Idempotency implementation
- RabbitMQ retry strategy
- Timeout and fallback mechanisms
- robots.txt compliance approach
- OpenAI Vision integration
- Rate limiting configuration
- Security considerations

## Git History

This project was developed with clear, focused commits:

1. Initial project structure and configuration
2. API implementation with Express and MongoDB
3. Worker implementation with Playwright
4. Frontend implementation with Vue 3
5. Build scripts and E2E tests
6. Documentation and polish

## Technologies Used

- **Backend**: Node.js 20, Express, TypeScript
- **Frontend**: Vue 3, Vite, TypeScript
- **Database**: MongoDB 7
- **Queue**: RabbitMQ 3
- **Browser**: Playwright
- **AI**: OpenAI GPT-4 Vision
- **Containerization**: Docker, Docker Compose

## Notes for Reviewers

- All requirements from the specification have been implemented
- Code is production-ready with proper error handling
- TypeScript provides type safety throughout
- Docker Compose makes setup trivial
- E2E tests validate core functionality
- design.md explains all architectural choices
- Clean commit history demonstrates development process

## Environment Variables

All configuration is in `.env` (already configured with provided OpenAI key):
- MongoDB connection string
- RabbitMQ connection string
- API port
- OpenAI API key
- Mock mode toggle

## Development

For local development without Docker:

```bash
# Terminal 1 - MongoDB
mongod

# Terminal 2 - RabbitMQ
rabbitmq-server

# Terminal 3 - API
cd app/api
yarn install && yarn dev

# Terminal 4 - Worker
cd app/worker
yarn install && yarn dev

# Terminal 5 - Frontend
cd app/web
yarn install && yarn dev
```

Access frontend at http://localhost:5173 (Vite dev server)

---

**Author**: Mini Crawler Implementation for Yakkyo Fullstack Developer Research
**Date**: 2025
**License**: Private - Research Project
