import chalk from "chalk";
import ora from "ora";
import { readdir, rm } from "fs/promises";
import { downloadSkill, skillExists } from "../utils/github.js";
import { getClaudeSkillsDir, getSkillInstallPath } from "../utils/paths.js";
export async function updateCommand() {
    const skillsDir = getClaudeSkillsDir();
    // Find installed SendAI skills
    let installedSkills;
    try {
        const entries = await readdir(skillsDir);
        installedSkills = entries
            .filter((entry) => entry.startsWith("sendai-"))
            .map((entry) => entry.replace("sendai-", ""));
    }
    catch {
        console.log(chalk.yellow("No SendAI skills installed."));
        console.log(chalk.gray("Use: sendai-skills install <skill-name>"));
        return;
    }
    if (installedSkills.length === 0) {
        console.log(chalk.yellow("No SendAI skills installed."));
        console.log(chalk.gray("Use: sendai-skills install <skill-name>"));
        return;
    }
    console.log(chalk.cyan(`\nUpdating ${installedSkills.length} installed skill(s)...\n`));
    let updated = 0;
    let failed = 0;
    let removed = 0;
    for (const skillName of installedSkills) {
        const installPath = getSkillInstallPath(skillName);
        const spinner = ora(`Updating ${skillName}...`).start();
        try {
            // Check if skill still exists on GitHub
            const exists = await skillExists(skillName);
            if (!exists) {
                spinner.warn(`${skillName}: No longer available on remote, removing...`);
                await rm(installPath, { recursive: true, force: true });
                removed++;
                continue;
            }
            // Remove old version and download fresh
            await rm(installPath, { recursive: true, force: true });
            await downloadSkill(skillName, installPath);
            spinner.succeed(`${skillName}: Updated`);
            updated++;
        }
        catch (error) {
            spinner.fail(`${skillName}: ${error instanceof Error ? error.message : "Update failed"}`);
            failed++;
        }
    }
    // Summary
    console.log();
    if (updated > 0) {
        console.log(chalk.green(`Successfully updated ${updated} skill(s)`));
    }
    if (removed > 0) {
        console.log(chalk.yellow(`Removed ${removed} unavailable skill(s)`));
    }
    if (failed > 0) {
        console.log(chalk.red(`Failed to update ${failed} skill(s)`));
    }
}
//# sourceMappingURL=update.js.map