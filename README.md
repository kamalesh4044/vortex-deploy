# Vortex Deploy

Vortex Deploy is a self-hosted deployment dashboard for small web projects. It clones a Git repository, installs dependencies, runs a production build when one exists, and serves the deployed output from a local URL.

## Features

- Clean local dashboard with deployment metrics, project controls, and live activity logs.
- Safer deploy API with project-name validation and repository URL validation.
- Persistent deployment metadata stored in `.vortex/deployments.json`.
- Per-project build logs retained for quick debugging.
- Server-sent events for live log and status updates.
- Redeploy and delete actions from the UI.
- Automatic static output detection for `dist`, `build`, `out`, and `public`.
- Health endpoint for uptime and project counts.

## Quick Start

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Deploy With The API

```bash
curl -X POST http://localhost:3000/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-app",
    "repoUrl": "https://github.com/user/my-app.git",
    "branch": "main"
  }'
```

The live app will be served at:

```text
http://localhost:3000/host/my-app/
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Engine status, uptime, and deployment counts. |
| `GET` | `/projects` | List all deployments. |
| `GET` | `/projects/:project` | Get one deployment, including logs. |
| `POST` | `/deploy` | Clone or update a repo and build it. |
| `POST` | `/projects/:project/redeploy` | Redeploy an existing project. |
| `DELETE` | `/projects/:project` | Remove a deployment and local files. |
| `GET` | `/events` | Server-sent deployment and log events. |

## Deploy Options

| Field | Required | Notes |
| --- | --- | --- |
| `projectName` | Yes | Lowercase letters, numbers, and hyphens. |
| `repoUrl` | Yes | `http` or `https` Git repository URL. |
| `branch` | No | Used on first clone. |
| `installCommand` | No | NPM arguments such as `ci` or `install`. |
| `buildCommand` | No | NPM arguments such as `run build`. |

## Project Storage

```text
deployments/        cloned projects and build output
.vortex/            deployment metadata
public/             dashboard UI
```

## Notes

- Vortex Deploy currently runs Node/NPM builds directly on the host machine.
- Use it on trusted infrastructure and deploy trusted repositories.
- Set `PORT=4000` or another value to change the dashboard port.
