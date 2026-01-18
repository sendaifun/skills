import chalk from "chalk";
import ora from "ora";
import { mkdir, access } from "fs/promises";
import {
  downloadSkill,
  fetchSkillsList,
  skillExists,
} from "../utils/github.js";
import {
  getClaudeSkillsDir,
  getSkillInstallPath,
  normalizeSkillName,
} from "../utils/paths.js";

interface InstallOptions {
  all?: boolean;
}

export async function installCommand(
  skills: string[],
  options: InstallOptions
): Promise<void> {
  try {
    // Ensure Claude skills directory exists
    const skillsDir = getClaudeSkillsDir();
    await mkdir(skillsDir, { recursive: true });

    let skillsToInstall: string[];

    if (options.all) {
      const spinner = ora("Fetching all available skills...").start();
      const allSkills = await fetchSkillsList();
      skillsToInstall = allSkills.map((s) => s.name);
      spinner.stop();
      console.log(
        chalk.cyan(`\nInstalling all ${skillsToInstall.length} skills...\n`)
      );
    } else {
      if (skills.length === 0) {
        console.log(chalk.yellow("No skills specified."));
        console.log(
          chalk.gray("Usage: sendai-skills install <skill-name> [skill-name...]")
        );
        console.log(chalk.gray("       sendai-skills install --all"));
        process.exit(1);
      }
      skillsToInstall = skills.map(normalizeSkillName);
    }

    let installed = 0;
    let failed = 0;
    let skipped = 0;

    for (const skillName of skillsToInstall) {
      const installPath = getSkillInstallPath(skillName);

      // Check if already installed
      try {
        await access(installPath);
        console.log(
          chalk.yellow(`  ${skillName}: Already installed (use update to refresh)`)
        );
        skipped++;
        continue;
      } catch {
        // Not installed, continue with installation
      }

      const spinner = ora(`Installing ${skillName}...`).start();

      try {
        // Check if skill exists on GitHub
        const exists = await skillExists(skillName);
        if (!exists) {
          spinner.fail(`${skillName}: Skill not found`);
          failed++;
          continue;
        }

        // Download and install the skill
        await downloadSkill(skillName, installPath);
        spinner.succeed(`${skillName}: Installed to ${installPath}`);
        installed++;
      } catch (error) {
        spinner.fail(
          `${skillName}: ${error instanceof Error ? error.message : "Installation failed"}`
        );
        failed++;
      }
    }

    // Summary
    console.log();
    if (installed > 0) {
      console.log(chalk.green(`Successfully installed ${installed} skill(s)`));
    }
    if (skipped > 0) {
      console.log(chalk.yellow(`Skipped ${skipped} already installed skill(s)`));
    }
    if (failed > 0) {
      console.log(chalk.red(`Failed to install ${failed} skill(s)`));
    }

    if (installed > 0) {
      console.log(
        chalk.gray(
          `\nSkills installed to: ${skillsDir}`
        )
      );
      console.log(
        chalk.gray(
          "Restart Claude Code or start a new session to use the installed skills."
        )
      );
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    process.exit(1);
  }
}
