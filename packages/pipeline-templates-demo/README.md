# Pipeline Templates Demo

A Node.js API demonstrating **reusable pipeline templates** — extracting shared CI/CD logic into reusable files so pipelines read as outlines rather than long inline scripts. The pipeline architecture is the subject; the API just provides a real test suite to run.

**In plain English:** Shows how to write the automatic build-and-test steps once and reuse them, for three popular CI services, instead of copying the same steps into every project.

## What Pipeline Templates Solve

Without templates, every pipeline duplicates the same steps:

```yaml
# Without templates — repeated in every stage
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
  - script: npm ci
  - script: npm run lint
  - script: npm test
  - task: PublishTestResults@2
    ...
```

With templates, you define it once and reference it everywhere:

```yaml
# With templates — main pipeline is an outline
stages:
  - stage: CI
    jobs:
      - template: .azure/templates/jobs/ci-job.yml
        parameters:
          nodeVersion: '20.x'
          withCoverage: true

  - template: .azure/templates/stages/deploy-stage.yml
    parameters:
      environment: staging
      healthUrl: 'https://staging.myapp.com/health'
```

## Three-Platform Comparison

| Platform | Template type | Keyword | Template file |
|---|---|---|---|
| **Azure DevOps** | Steps template | `template:` | `.azure/templates/steps/*.yml` |
| **Azure DevOps** | Jobs template | `template:` | `.azure/templates/jobs/*.yml` |
| **Azure DevOps** | Stages template | `template:` | `.azure/templates/stages/*.yml` |
| **GitHub Actions** | Reusable workflow | `uses:` | `.github/workflows/reusable-ci.yml` |
| **GitLab CI** | Hidden job | `extends:` | `.gitlab/ci-templates.yml` |
| **GitLab CI** | Local include | `include: local:` | `.gitlab/ci-templates.yml` |

### Syntax comparison

```yaml
# Azure DevOps — call a steps template with parameters
steps:
  - template: .azure/templates/steps/install.yml
    parameters:
      nodeVersion: '20.x'

# Azure DevOps — call a jobs template
jobs:
  - template: .azure/templates/jobs/ci-job.yml
    parameters:
      withCoverage: true

# GitHub Actions — call a reusable workflow
jobs:
  ci:
    uses: ./.github/workflows/reusable-ci.yml
    with:
      node-version: '20'
      upload-coverage: true

# GitLab CI — extend a hidden job template
test:
  extends: .node_job
  script: [npm ci, npm test]
```

## Deployment Lifecycle Hooks (Azure DevOps)

The deploy stage template uses a `deployment` job with the `runOnce` strategy, exposing full lifecycle hooks:

```
preDeploy        → validate environment before touching anything
deploy           → the actual release steps
routeTraffic     → switch load balancer / update DNS
postRouteTraffic → health check AFTER traffic is live (curl + retry loop)
on.success       → notify on success
on.failure       → rollback or alert
```

This maps directly to the Pluralsight "Azure DevOps Pipelines" course coverage of deployment strategies. The health check step (`curl` with retry) runs in `postRouteTraffic` — after traffic is switched, before the stage is marked successful.

## Template Directory Structure

```
.azure/templates/
├── steps/
│   ├── install.yml        # NodeTool@0 + npm ci (parameterised Node version)
│   ├── lint.yml           # npm run lint
│   ├── run-tests.yml      # Jest + PublishTestResults (parameterised coverage flag)
│   └── health-check.yml   # curl retry loop — used in postRouteTraffic
├── jobs/
│   └── ci-job.yml         # Composes install + lint + run-tests into one job
└── stages/
    └── deploy-stage.yml   # Full runOnce deployment with all lifecycle hooks
```

## Running Locally

```bash
npm install
npm run lint
npm test
npm start     # API on http://localhost:3002
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/bookmarks` | List all bookmarks |
| GET | `/api/bookmarks/:id` | Get bookmark by ID |
| POST | `/api/bookmarks` | Create a bookmark |
| PUT | `/api/bookmarks/:id` | Update a bookmark |
| DELETE | `/api/bookmarks/:id` | Delete a bookmark |

## Test Coverage

**28 Jest tests** across two files:

| File | Tests | Pattern |
|---|---|---|
| `tests/unit/bookmarkService.test.js` | 17 | Direct service testing — create, read, update, delete, validation, reset |
| `tests/unit/routes.test.js` | 11 | Mock-injected service pattern — route handlers tested in isolation without a real service |

The mock injection pattern in `routes.test.js`:

```js
function mockService(overrides = {}) {
  return {
    getAll: jest.fn(() => []),
    getById: jest.fn(() => null),
    create: jest.fn(() => ({ id: 1, ... })),
    ...overrides,
  };
}

// Each test controls exactly what the service returns
const app = buildApp(mockService({ getById: jest.fn(() => null) }));
const res = await request(app).get('/api/bookmarks/999');
expect(res.status).toBe(404);
```

## Project Structure

```
pipeline-templates-demo/
├── src/
│   ├── bookmarkService.js         # In-memory CRUD service
│   ├── routes.js                  # Route factory (injectable service)
│   └── app.js                     # Express app setup
├── server.js                      # Entry point
├── tests/unit/
│   ├── bookmarkService.test.js
│   └── routes.test.js
├── .azure/
│   └── templates/
│       ├── steps/                 # Reusable step sequences
│       ├── jobs/                  # Reusable full jobs
│       └── stages/                # Reusable stages with lifecycle hooks
├── .github/
│   └── workflows/
│       ├── reusable-ci.yml        # Reusable workflow (GitHub template equivalent)
│       └── ci-cd.yml              # Main pipeline — calls the reusable workflow
├── .gitlab/
│   └── ci-templates.yml           # GitLab hidden job template
├── .gitlab-ci.yml                 # GitLab pipeline — extends templates, uses include:
└── azure-pipelines.yml            # Main Azure DevOps pipeline — calls all templates
```
