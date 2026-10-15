# schedule-connect-unfu Worker

Cloudflare Worker API serving university schedule data from an R2 bucket.

## Setup

```bash
pnpm install
```

The worker reads schedule data from the `schedule-connect-unfu` R2 bucket, bound as `SCHEDULES` in `wrangler.jsonc`. Populate the bucket with the output of the `schedule-connect` CLI (`entities.json`, `groups/`, `teachers/`, `classrooms/`).

## Development

```bash
pnpm dev
```

The `SCHEDULES` binding is configured with `"remote": true`, so `wrangler dev` reads from the real `schedule-connect-unfu` R2 bucket instead of a local emulation. The bucket must already contain the schedule data.

## Deploy

```bash
pnpm danger:deploy
```

Deploys minified, loading secrets from `.env`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev server (reads from the remote R2 bucket) |
| `pnpm danger:deploy` | Deploy to Cloudflare (minified, secrets from `.env`) |
| `pnpm typegen` | Regenerate `worker-configuration.d.ts` — rerun after changing `wrangler.jsonc` |
| `pnpm typecheck` | Type-check the worker with `tsc --noEmit` |

## Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | Set to `production` to enable auth & caching |
| `SCHEDULE_SEMESTER_START` | Semester start date (DD.MM.YYYY) |
| `SCHEDULE_SEMESTER_END` | Semester end date (DD.MM.YYYY) |
| `SCHEDULE_WEEK_START` | Starting week number |
| `SCHEDULE_WEEK_COUNT` | Total weeks in schedule cycle |
| `CACHE_NAME` | Cloudflare cache name |
| `CACHE_CTRL` | Cache-Control header value |
| `SERVICE_API_KEY` | Bearer token for production auth |

> Schedule data is stored in the `schedule-connect-unfu` R2 bucket (`SCHEDULES` binding), not in environment variables.

## API

### GET /v1/entities

List all groups, teachers, and classrooms.

### GET /v1/schedule/week/:type/:id/:day

Get schedule for an entity.

- `type`: `group`, `teacher`, or `location`
- `id`: entity identifier
- `day`: date in `DD.MM.YYYY` format

**Errors:** `INVALID_TYPE`, `INVALID_DAY_FORMAT`, `DAY_OUT_OF_RANGE`, `NO_ENTITY_FOUND`, `EMPTY_SCHEDULE`, `FAILED_TO_FETCH`
