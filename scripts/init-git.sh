#!/bin/bash

# Script to initialize git repository with clean commit history

cd "$(dirname "$0")/.."

echo "Initializing Git repository..."

# Initialize git if not already done
if [ ! -d .git ]; then
  git init
  echo "Git repository initialized"
else
  echo "Git repository already exists"
fi

# Create .gitignore if needed
if [ ! -f .gitignore ]; then
  cat > .gitignore << 'EOF'
node_modules/
dist/
build/
*.log
.env
.DS_Store
coverage/
*.local
api/public/
.vscode/
*.tsbuildinfo
EOF
fi

echo "Creating organized commit history..."

# Stage and commit in logical groups

# Commit 1: Project structure and configuration
git add .gitignore .env.example docker-compose.yml Dockerfile.* README.md package.json PROJECT.md 2>/dev/null
git add api/package.json api/tsconfig.json api/yarn.lock 2>/dev/null
git add worker/package.json worker/tsconfig.json worker/yarn.lock 2>/dev/null
git add web/package.json web/tsconfig.json web/tsconfig.node.json web/vite.config.ts web/yarn.lock web/index.html 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping commit 1 (no changes)"
else
  git commit -m "feat: initial project structure and configuration

- Add monorepo structure with api, worker, and web
- Configure Docker Compose with MongoDB, RabbitMQ, API, and Worker
- Add TypeScript configuration for all services
- Create Dockerfiles for API and Worker services
- Add environment configuration and README"
  echo "Created commit 1: Project structure"
fi

# Commit 2: API implementation
git add api/src/ 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping commit 2 (no changes)"
else
  git commit -m "feat: implement Express API with MongoDB and RabbitMQ

- POST /crawl endpoint with URL validation and normalization
- GET /crawl/:uid endpoint for status polling
- MongoDB integration with Mongoose models
- RabbitMQ publisher for crawl queue
- Rate limiting (10 req/min per IP)
- Health check endpoint
- Request ID middleware for logging
- Error handling middleware
- Idempotency check (5-minute window)"
  echo "Created commit 2: API implementation"
fi

# Commit 3: Worker implementation
git add worker/src/ 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping commit 3 (no changes)"
else
  git commit -m "feat: implement crawler worker with Playwright

- RabbitMQ consumer with prefetch=1
- Playwright integration for headless browsing
- Full-page screenshot capture (JPEG quality 50)
- robots.txt compliance checker
- OpenAI Vision API integration for design analysis
- Retry logic with max 2 attempts
- Dead-letter queue for failed messages
- Timeout handling (30s hard limit)
- SPA support with networkidle fallback
- MongoDB updates for crawl status"
  echo "Created commit 3: Worker implementation"
fi

# Commit 4: Frontend implementation
git add web/src/ 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping commit 4 (no changes)"
else
  git commit -m "feat: implement Vue 3 frontend with TypeScript

- Responsive single-page application
- URL input with real-time validation
- Polling with exponential backoff (2s to 30s)
- Loading states with progress indicator
- Screenshot and description display
- Error handling with retry functionality
- Modern gradient design"
  echo "Created commit 4: Frontend implementation"
fi

# Commit 5: Build scripts and tests
git add scripts/ 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping commit 5 (no changes)"
else
  git commit -m "feat: add build scripts and E2E tests

- yarn build-frontend script to compile and copy frontend
- E2E test suite with multiple URL types
- Idempotency validation
- robots.txt compliance testing
- Automatic Docker Compose stack management"
  echo "Created commit 5: Build scripts and tests"
fi

# Commit 6: Documentation
git add design.md STATUS.md SUMMARY.md QUICKSTART.md LOCAL_DEV.md 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping commit 6 (no changes)"
else
  git commit -m "docs: add comprehensive design documentation

- Architectural overview and component descriptions
- Detailed design decisions with rationales
- Trade-off analysis for key choices
- Failure modes and recovery strategies
- Security considerations
- Performance optimizations
- Testing strategy
- Future enhancement ideas"
  echo "Created commit 6: Documentation"
fi

# Final commit for any remaining files
git add . 2>/dev/null
if git diff --cached --quiet; then
  echo "Skipping final commit (no changes)"
else
  git commit -m "chore: finalize project setup and polish

- Add initialization script
- Complete documentation
- Final configuration tweaks"
  echo "Created final commit"
fi

echo ""
echo "Git repository initialized with clean commit history"
echo ""
if git log --oneline 2>/dev/null | head -1 > /dev/null; then
  echo "Commit history:"
  git log --oneline --graph --decorate
else
  echo "No commits created (all files may already be committed or ignored)"
fi

echo ""
echo "Next steps:"
echo "   1. Review commits: git log"
echo "   2. Build frontend: yarn build-frontend"
echo "   3. Start services: docker compose up --build"
echo "   4. Run tests: yarn test:e2e"
