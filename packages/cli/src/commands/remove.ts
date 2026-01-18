import chalk from "chalk";
import ora from "ora";
import { rm, access } from "fs/promises";
import { getSkillInstallPath, normalizeSkillName } from "../utils/paths.js";

export async function removeCommand(skills: string[]): Promise<void> {
  if (skills.length === 0) {
    console.log(chalk.yellow("No skills specified."));
    console.log(chalk.gray("Usage: sendai-skills remove <skill-name> [skill-name...]"));
    process.exit(1);
  }

  let removed = 0;
  let notFound = 0;
  let failed = 0;

  for (const skill of skills) {
    const skillName = normalizeSkillName(skill);
    const installPath = getSkillInstallPath(skillName);

    // Check if skill is installed
    try {
      await access(installPath);
    } catch {
      console.log(chalk.yellow(`  ${skillName}: Not installed`));
      notFound++;
      continue;
    }

    const spinner = ora(`Removing ${skillName}...`).start();

    try {
      await rm(installPath, { recursive: true, force: true });
      spinner.succeed(`${skillName}: Removed`);
      removed++;
    } catch (error) {
      spinner.fail(
        `${skillName}: ${error instanceof Error ? error.message : "Removal failed"}`
      );
      failed++;
    }
  }

  // Summary
  console.log();
  if (removed > 0) {
    console.log(chalk.green(`Successfully removed ${removed} skill(s)`));
  }
  if (notFound > 0) {
    console.log(chalk.yellow(`${notFound} skill(s) were not installed`));
  }
  if (failed > 0) {
    console.log(chalk.red(`Failed to remove ${failed} skill(s)`));
  }
}
