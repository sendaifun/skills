import chalk from "chalk";
import ora from "ora";
import { fetchSkillsList } from "../utils/github.js";
import { getSkillInstallPath } from "../utils/paths.js";
import { access } from "fs/promises";

export async function listCommand(): Promise<void> {
  const spinner = ora("Fetching available skills...").start();

  try {
    const skills = await fetchSkillsList();
    spinner.stop();

    console.log(chalk.bold("\nAvailable SendAI Skills:\n"));

    // Check which skills are installed
    const installedStatus = await Promise.all(
      skills.map(async (skill) => {
        const installPath = getSkillInstallPath(skill.name);
        try {
          await access(installPath);
          return true;
        } catch {
          return false;
        }
      })
    );

    // Display skills with installation status
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      const installed = installedStatus[i];
      const status = installed
        ? chalk.green(" [installed]")
        : chalk.gray(" [not installed]");

      console.log(
        `  ${chalk.cyan(skill.name.padEnd(25))}${status}`
      );
      console.log(
        `    ${chalk.gray(truncate(skill.description, 70))}\n`
      );
    }

    console.log(
      chalk.gray(
        `\nTotal: ${skills.length} skills available, ${installedStatus.filter(Boolean).length} installed`
      )
    );
    console.log(
      chalk.gray(`\nUsage: sendai-skills install <skill-name> [skill-name...]`)
    );
  } catch (error) {
    spinner.fail("Failed to fetch skills");
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    process.exit(1);
  }
}

function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length - 3) + "...";
}
