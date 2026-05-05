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

    console.log(chalk.yellow(`\n[Vortex] Starting deployment for: ${projectName}`));

    try {
        // Check if project already exists
        const exists = await fs.access(projectPath).then(() => true).catch(() => false);

        if (exists) {
            console.log(chalk.blue(`[Vortex] Project exists. Pulling latest changes...`));
            await git.cwd(projectPath).pull();
        } else {
            console.log(chalk.blue(`[Vortex] New project. Cloning from GitHub...`));
            await git.clone(repoUrl, projectPath);
        }

        console.log(chalk.green(`\n✅ [Vortex] Code successfully synchronized for ${projectName}`));
        
        // In the next phase, we will add Docker Build logic here!
        
        res.json({
            status: 'success',
            message: `Project ${projectName} is synchronized and ready for build.`,
            path: projectPath
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
