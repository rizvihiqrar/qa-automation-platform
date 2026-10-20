# Self-hosted Langfuse

The [Langfuse](https://langfuse.com/) the `langfuse-traces` CI job starts, so that every AI test in this package can be checked against its trace. It is Langfuse's own `docker-compose.yml` from release v4.50.0 with three changes, listed at the top of [`docker-compose.yml`](docker-compose.yml): both Langfuse images pinned to `4.50.0` instead of the floating tag `4`, telemetry off, and a comment.

**In plain English:** Langfuse is a tool that records what an AI was asked and what it answered. This folder starts a private copy of it, so the tests can check that the record is complete and correct.

## Run it on your own machine (optional)

CI doesn't need this. It needs Docker (six containers: Langfuse web and worker, Postgres, ClickHouse, Redis, MinIO).

```bash
cd packages/llm-judge-check
docker compose -f langfuse/docker-compose.yml --env-file langfuse/local.env up -d
# wait until http://localhost:3000/api/public/health answers (2–3 minutes on first start)

export LANGFUSE_BASE_URL=http://localhost:3000 LANGFUSE_PUBLIC_KEY=pk-lf-local-only LANGFUSE_SECRET_KEY=sk-lf-local-only
npm run traces -- --out traces-report
```

Then sign in at http://localhost:3000 as `local@llm-judge-check.test` / `local-only-password`. A test's trace is at `http://localhost:3000/project/llm-judge-check/traces/<trace id>`. The trace ID is the one in the published traces report and in promptfoo's results (`metadata.traceId`). It's the same ID on every machine, because it is derived from the test, not generated.

Stop it with `docker compose -f langfuse/docker-compose.yml --env-file langfuse/local.env down -v` (`-v` also deletes the stored traces).

## The keys in `local.env` are public on purpose

[`local.env`](local.env) creates an organization, a project with fixed API keys, and a user when Langfuse first starts (Langfuse's [headless initialization](https://langfuse.com/self-hosting/headless-initialization)). The passwords in the compose file are Langfuse's own placeholders. All of this is for a throwaway instance on `localhost` or a CI runner. Never expose it, and never reuse these values.

## Notes

- **Release v4.51.0 has no web image.** The first pin was to 4.51.0, the newest release at least two weeks old. Its worker image exists, but `langfuse/langfuse:4.51.0` was never published, on Langfuse's registry or Docker Hub, so the stack couldn't start. Upstream's floating tag `4` would have hidden that. 4.50.0 has both images and the same compose file.
- **MinIO uses Chainguard's rolling image** (`cgr.dev/chainguard/minio`), as upstream does. Chainguard's free images carry only a rolling `latest` tag. It only stores raw event files here, and the check reads everything back through Langfuse's API.
- **Langfuse's docs recommend 4 cores and 16 GiB** for a real deployment. A standard GitHub runner (4 cores, 16 GB) runs this one.
