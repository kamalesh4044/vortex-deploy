import express from 'express';
import { simpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, 'deployments');

const app = express();
app.use(express.json());

// Ensure the deployments directory exists
await fs.mkdir(PROJECTS_DIR, { recursive: true });

console.log(chalk.bold.cyan('\n🌪️  VORTEX-DEPLOY ENGINE STARTING...'));

/**
 * Advanced Build Engine
 * Simulates a production-grade build process with isolated stages.
 */
async function simulateBuild(projectName) {
    const stages = [
        { name: 'Environment Audit', duration: 1500 },
        { name: 'Dependency Resolution', duration: 3000 },
        { name: 'Optimizing Assets', duration: 4000 },
        { name: 'Compiling Production Bundle', duration: 5000 },
        { name: 'Docker Image Layering', duration: 2500 }
    ];

    console.log(chalk.magenta(`\n[Vortex] Entering Build Phase for: ${projectName}`));

    for (const stage of stages) {
        console.log(chalk.gray(`[Build] ${stage.name}...`));
        await new Promise(resolve => setTimeout(resolve, stage.duration));
        console.log(chalk.green(`[Build] ✓ ${stage.name} Complete`));
    }

    console.log(chalk.bold.green(`\n✨ [Vortex] Build Success: Image created for ${projectName}`));
}

/**
 * Endpoint: /deploy
 * Triggers a deployment for a specific repository.
 */
app.post('/deploy', async (req, res) => {
    const { repoUrl, projectName } = req.body;

    if (!repoUrl || !projectName) {
        return res.status(400).json({ error: 'Missing repoUrl or projectName' });
    }

    const projectPath = path.join(PROJECTS_DIR, projectName);
    const git = simpleGit();

    console.log(chalk.yellow(`\n[Vortex] Starting deployment sequence for: ${projectName}`));

    try {
        // Step 1: Git Synchronization
        const exists = await fs.access(projectPath).then(() => true).catch(() => false);
        if (exists) {
            console.log(chalk.blue(`[Vortex] Project exists. Pulling latest changes...`));
            await git.cwd(projectPath).pull();
        } else {
            console.log(chalk.blue(`[Vortex] New project. Cloning from GitHub...`));
            await git.clone(repoUrl, projectPath);
        }

        // Step 2: Advanced Build Execution
        await simulateBuild(projectName);
        
        console.log(chalk.bold.cyan(`\n🚀 [Vortex] DEPLOYMENT LIVE: ${projectName}`));
        
        res.json({
            status: 'success',
            message: `Project ${projectName} is live.`,
            deploymentUrl: `http://${projectName}.local.vortex`,
            logs: 'Build successful. Docker container started.'
        });

    } catch (error) {
        console.error(chalk.red(`\n❌ [Vortex] Deployment Failed: ${error.message}`));
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(chalk.bold.green(`🚀 VORTEX-DEPLOY Listening on http://localhost:${PORT}`));
    console.log(chalk.gray(`Waiting for deployment triggers...\n`));
});
