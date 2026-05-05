import express from 'express';
import { simpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, 'deployments');
const DATA_DIR = path.join(__dirname, '.vortex');
const DEPLOYMENTS_FILE = path.join(DATA_DIR, 'deployments.json');
const LOG_LIMIT = 400;
const DEFAULT_PORT = 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const deployments = new Map();
const clients = new Set();

await fs.mkdir(PROJECTS_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });
await loadDeployments();

function now() {
    return new Date().toISOString();
}

function npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function sanitizeProjectName(value) {
    const name = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(name)) {
        throw new Error('Project name must be 3-50 characters and use lowercase letters, numbers, and hyphens.');
    }
    return name;
}

function validateRepoUrl(value) {
    const repoUrl = String(value || '').trim();
    let parsed;

    try {
        parsed = new URL(repoUrl);
    } catch {
        throw new Error('Repository URL must be a valid http(s) Git URL.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http(s) repository URLs are supported.');
    }

    if (!parsed.hostname || parsed.pathname.length < 2) {
        throw new Error('Repository URL is missing an owner or repository path.');
    }

    return repoUrl;
}

function projectPathFor(projectName) {
    const resolved = path.resolve(PROJECTS_DIR, projectName);
    const root = path.resolve(PROJECTS_DIR);

    if (!resolved.startsWith(root + path.sep)) {
        throw new Error('Invalid project path.');
    }

    return resolved;
}

function publicProject(project) {
    return {
        name: project.name,
        repoUrl: project.repoUrl,
        branch: project.branch,
        status: project.status,
        livePath: project.livePath,
        url: `/host/${project.name}/`,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        lastDeployAt: project.lastDeployAt,
        lastSuccessAt: project.lastSuccessAt,
        lastFailureAt: project.lastFailureAt,
        buildCommand: project.buildCommand,
        installCommand: project.installCommand,
        error: project.error || null,
        logs: project.logs || [],
    };
}

async function loadDeployments() {
    try {
        const raw = await fs.readFile(DEPLOYMENTS_FILE, 'utf8');
        const items = JSON.parse(raw);
        items.forEach((project) => deployments.set(project.name, project));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(chalk.yellow(`[Vortex] Could not load deployment store: ${error.message}`));
        }
    }
}

async function saveDeployments() {
    const payload = JSON.stringify([...deployments.values()], null, 2);
    await fs.writeFile(DEPLOYMENTS_FILE, payload);
}

function broadcast(event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    clients.forEach((client) => client.write(data));
}

async function updateProject(projectName, patch) {
    const current = deployments.get(projectName);
    if (!current) return null;

    const next = { ...current, ...patch, updatedAt: now() };
    deployments.set(projectName, next);
    await saveDeployments();
    broadcast('project', publicProject(next));
    return next;
}

async function addLog(projectName, message, level = 'info') {
    const project = deployments.get(projectName);
    if (!project) return;

    const entry = { time: now(), level, message };
    const logs = [...(project.logs || []), entry].slice(-LOG_LIMIT);
    await updateProject(projectName, { logs });
    broadcast('log', { projectName, ...entry });
}

async function pathExists(target) {
    return fs.access(target).then(() => true).catch(() => false);
}

async function detectLivePath(projectPath) {
    const candidates = ['dist', 'build', 'out', 'public'];

    for (const folder of candidates) {
        const candidate = path.join(projectPath, folder);
        if (await pathExists(candidate)) return candidate;
    }

    return projectPath;
}

async function hasPackageScript(projectPath, scriptName) {
    try {
        const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf8');
        const pkg = JSON.parse(raw);
        return Boolean(pkg.scripts?.[scriptName]);
    } catch {
        return false;
    }
}

async function readPackageJson(projectPath) {
    try {
        const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function isViteProject(projectPath) {
    const pkg = await readPackageJson(projectPath);
    const dependencies = {
        ...(pkg?.dependencies || {}),
        ...(pkg?.devDependencies || {}),
    };

    return Boolean(dependencies.vite);
}

function withViteBaseArgs(args, projectName) {
    const isNpmBuild = args[0] === 'run' && args[1] === 'build';
    const alreadyHasBase = args.includes('--base') || args.some((arg) => arg.startsWith('--base='));

    if (!isNpmBuild || alreadyHasBase) {
        return args;
    }

    return [...args, '--', '--base', `/host/${projectName}/`];
}

function runCommand(command, args, cwd, projectName) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            shell: process.platform === 'win32',
            windowsHide: true,
        });
        let output = '';

        const handleChunk = (chunk, level) => {
            const text = chunk.toString();
            output += text;
            text.split(/\r?\n/).filter(Boolean).forEach((line) => {
                void addLog(projectName, line.slice(0, 800), level);
            });
        };

        child.stdout.on('data', (chunk) => handleChunk(chunk, 'info'));
        child.stderr.on('data', (chunk) => handleChunk(chunk, 'warn'));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
            }
        });
    });
}

async function installDependencies(projectName, projectPath, installCommand) {
    if (!(await pathExists(path.join(projectPath, 'package.json')))) {
        await addLog(projectName, 'No package.json found; skipping dependency install.', 'warn');
        return;
    }

    const hasLockfile = await pathExists(path.join(projectPath, 'package-lock.json'));
    let args = installCommand
        ? installCommand.split(/\s+/).filter(Boolean)
        : hasLockfile ? ['ci'] : ['install'];

    if (args[0] === 'ci' && !hasLockfile) {
        await addLog(projectName, 'npm ci needs package-lock.json; falling back to npm install.', 'warn');
        args = ['install'];
    }

    await addLog(projectName, `Installing dependencies with npm ${args.join(' ')}...`);
    await runCommand(npmCommand(), args, projectPath, projectName);
}

async function runBuild(projectName, projectPath, buildCommand) {
    if (buildCommand) {
        let args = buildCommand.split(/\s+/).filter(Boolean);
        if (await isViteProject(projectPath)) {
            args = withViteBaseArgs(args, projectName);
        }
        await addLog(projectName, `Running build command: npm ${args.join(' ')}...`);
        await runCommand(npmCommand(), args, projectPath, projectName);
        return;
    }

    if (await hasPackageScript(projectPath, 'build')) {
        let args = ['run', 'build'];
        if (await isViteProject(projectPath)) {
            args = withViteBaseArgs(args, projectName);
        }
        await addLog(projectName, 'Running production build...');
        await runCommand(npmCommand(), args, projectPath, projectName);
    } else {
        await addLog(projectName, 'No build script found; serving project files directly.', 'warn');
    }
}

async function deployProject(input) {
    const projectName = sanitizeProjectName(input.projectName);
    const repoUrl = validateRepoUrl(input.repoUrl);
    const branch = String(input.branch || '').trim();
    const installCommand = String(input.installCommand || '').trim();
    const buildCommand = String(input.buildCommand || '').trim();
    const projectPath = projectPathFor(projectName);
    const existing = deployments.get(projectName);

    deployments.set(projectName, {
        name: projectName,
        repoUrl,
        branch,
        installCommand,
        buildCommand,
        status: 'queued',
        livePath: existing?.livePath || projectPath,
        createdAt: existing?.createdAt || now(),
        updatedAt: now(),
        lastDeployAt: now(),
        lastSuccessAt: existing?.lastSuccessAt || null,
        lastFailureAt: existing?.lastFailureAt || null,
        logs: existing?.logs || [],
        error: null,
    });
    await saveDeployments();
    await addLog(projectName, `Deployment queued for ${repoUrl}`);

    try {
        await updateProject(projectName, { status: 'syncing', error: null });
        const git = simpleGit();

        if (await pathExists(projectPath)) {
            await addLog(projectName, 'Project exists locally; pulling latest changes...');
            await git.cwd(projectPath).pull();
        } else {
            await addLog(projectName, 'Cloning repository...');
            const cloneArgs = branch ? ['--branch', branch, '--single-branch'] : [];
            await git.clone(repoUrl, projectPath, cloneArgs);
        }

        await updateProject(projectName, { status: 'building' });
        await installDependencies(projectName, projectPath, installCommand);
        await runBuild(projectName, projectPath, buildCommand);

        const livePath = await detectLivePath(projectPath);
        await updateProject(projectName, {
            status: 'live',
            livePath,
            lastSuccessAt: now(),
            error: null,
        });
        await addLog(projectName, `Deployment live at /host/${projectName}/`, 'success');
        return publicProject(deployments.get(projectName));
    } catch (error) {
        await updateProject(projectName, {
            status: 'failed',
            lastFailureAt: now(),
            error: error.message,
        });
        await addLog(projectName, error.message, 'error');
        throw error;
    }
}

app.use('/host/:project', async (req, res, next) => {
    try {
        const projectName = sanitizeProjectName(req.params.project);
        const project = deployments.get(projectName);

        if (!project) {
            return res.status(404).send('Deployment not found.');
        }

        express.static(project.livePath)(req, res, next);
    } catch (error) {
        next(error);
    }
});

app.get('/health', (req, res) => {
    const projects = [...deployments.values()];
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        projects: projects.length,
        live: projects.filter((project) => project.status === 'live').length,
        failed: projects.filter((project) => project.status === 'failed').length,
    });
});

app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
});

app.get('/projects', (req, res) => {
    const projects = [...deployments.values()]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(publicProject);

    res.json(projects);
});

app.get('/projects/:project', (req, res) => {
    try {
        const projectName = sanitizeProjectName(req.params.project);
        const project = deployments.get(projectName);

        if (!project) return res.status(404).json({ error: 'Project not found.' });
        res.json(publicProject(project));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/deploy', async (req, res) => {
    try {
        const project = await deployProject(req.body);
        res.json({ status: 'success', project });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/projects/:project/redeploy', async (req, res) => {
    try {
        const projectName = sanitizeProjectName(req.params.project);
        const project = deployments.get(projectName);

        if (!project) return res.status(404).json({ error: 'Project not found.' });
        const deployed = await deployProject({ ...project, ...req.body, projectName });
        res.json({ status: 'success', project: deployed });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/projects/:project', async (req, res) => {
    try {
        const projectName = sanitizeProjectName(req.params.project);
        const projectPath = projectPathFor(projectName);

        deployments.delete(projectName);
        await saveDeployments();
        await fs.rm(projectPath, { recursive: true, force: true });
        broadcast('deleted', { projectName });
        res.json({ status: 'deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
});

const PORT = Number(process.env.PORT || DEFAULT_PORT);
app.listen(PORT, () => {
    console.log(chalk.bold.cyan('\nVortex Deploy is online'));
    console.log(chalk.green(`Dashboard: http://localhost:${PORT}`));
    console.log(chalk.gray(`Deployments directory: ${PROJECTS_DIR}\n`));
});
