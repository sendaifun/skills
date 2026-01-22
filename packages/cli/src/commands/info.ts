import chalk from "chalk";
import ora from "ora";
import { access, readFile, readdir } from "fs/promises";
import { join } from "path";
import { fetchSkillMetadata, fetchDirectoryContents } from "../utils/github.js";
import { getSkillInstallPath, normalizeSkillName } from "../utils/paths.js";

interface SkillInfo {
  name: string;
  description: string;
  installed: boolean;
  installPath?: string;
  resources: {
    examples: string[];
    docs: string[];
    templates: string[];
    other: string[];
  };
  localContent?: string;
}

/**
 * Fetch skill resources from GitHub
 */
async function fetchSkillResources(skillName: string): Promise<SkillInfo["resources"]> {
  const resources: SkillInfo["resources"] = {
    examples: [],
    docs: [],
    templates: [],
    other: [],
  };

  const directories = ["examples", "docs", "templates", "resources"];

  for (const dir of directories) {
    try {
      const contents = await fetchDirectoryContents(skillName, dir);
      const files = contents.map((item) => `${dir}/${item.name}`);

      if (dir === "examples") {
        resources.examples = files;
      } else if (dir === "docs") {
        resources.docs = files;
      } else if (dir === "templates") {
        resources.templates = files;
      } else {
        resources.other = files;
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return resources;
}

/**
 * Get local skill resources
 */
async function getLocalResources(installPath: string): Promise<SkillInfo["resources"]> {
  const resources: SkillInfo["resources"] = {
    examples: [],
    docs: [],
    templates: [],
    other: [],
  };

  const directories = ["examples", "docs", "templates", "resources"];

  for (const dir of directories) {
    try {
      const dirPath = join(installPath, dir);
      const files = await readdir(dirPath);
      const paths = files.map((f) => `${dir}/${f}`);

      if (dir === "examples") {
        resources.examples = paths;
      } else if (dir === "docs") {
        resources.docs = paths;
      } else if (dir === "templates") {
        resources.templates = paths;
      } else {
        resources.other = paths;
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return resources;
}

export async function infoCommand(skillName: string): Promise<void> {
  if (!skillName || skillName.trim().length === 0) {
    console.log(chalk.yellow("Please provide a skill name."));
    console.log(chalk.gray("Usage: sendai-skills info <skill-name>"));
    console.log(chalk.gray("Example: sendai-skills info kamino"));
    process.exit(1);
  }

  const normalizedName = normalizeSkillName(skillName);
  const spinner = ora(`Fetching info for "${normalizedName}"...`).start();

  try {
    // Check if installed locally
    const installPath = getSkillInstallPath(normalizedName);
    let installed = false;
    let localContent: string | undefined;

    try {
      await access(installPath);
      installed = true;

      // Read local SKILL.md
      const skillMdPath = join(installPath, "SKILL.md");
      localContent = await readFile(skillMdPath, "utf-8");
    } catch {
      installed = false;
    }

    // Fetch metadata from GitHub
    const metadata = await fetchSkillMetadata(normalizedName);

    // Fetch resources
    let resources: SkillInfo["resources"];
    if (installed) {
      resources = await getLocalResources(installPath);
    } else {
      resources = await fetchSkillResources(normalizedName);
    }

    spinner.stop();

    // Display info
    console.log(chalk.bold(`\n${metadata.name}\n`));
    console.log(chalk.white(metadata.description));
    console.log();

    // Installation status
    if (installed) {
      console.log(chalk.green("Status: Installed"));
      console.log(chalk.gray(`Path: ${installPath}`));
    } else {
      console.log(chalk.yellow("Status: Not installed"));
    }
    console.log();

    // Resources
    const totalResources =
      resources.examples.length +
      resources.docs.length +
      resources.templates.length +
      resources.other.length;

    if (totalResources > 0) {
      console.log(chalk.bold("Resources:"));

      if (resources.examples.length > 0) {
        console.log(chalk.cyan(`  Examples (${resources.examples.length}):`));
        for (const file of resources.examples.slice(0, 5)) {
          console.log(chalk.gray(`    - ${file}`));
        }
        if (resources.examples.length > 5) {
          console.log(chalk.gray(`    ... and ${resources.examples.length - 5} more`));
        }
      }

      if (resources.docs.length > 0) {
        console.log(chalk.cyan(`  Documentation (${resources.docs.length}):`));
        for (const file of resources.docs.slice(0, 5)) {
          console.log(chalk.gray(`    - ${file}`));
        }
        if (resources.docs.length > 5) {
          console.log(chalk.gray(`    ... and ${resources.docs.length - 5} more`));
        }
      }

      if (resources.templates.length > 0) {
        console.log(chalk.cyan(`  Templates (${resources.templates.length}):`));
        for (const file of resources.templates.slice(0, 5)) {
          console.log(chalk.gray(`    - ${file}`));
        }
        if (resources.templates.length > 5) {
          console.log(chalk.gray(`    ... and ${resources.templates.length - 5} more`));
        }
      }

      if (resources.other.length > 0) {
        console.log(chalk.cyan(`  Other resources (${resources.other.length}):`));
        for (const file of resources.other.slice(0, 5)) {
          console.log(chalk.gray(`    - ${file}`));
        }
        if (resources.other.length > 5) {
          console.log(chalk.gray(`    ... and ${resources.other.length - 5} more`));
        }
      }

      console.log();
    }

    // Content preview
    if (localContent) {
      const lines = localContent.split("\n");
      const contentStart = lines.findIndex((line) => line === "---" && lines.indexOf(line) > 0);
      if (contentStart !== -1) {
        const previewLines = lines.slice(contentStart + 1, contentStart + 10).join("\n");
        console.log(chalk.bold("Content Preview:"));
        console.log(chalk.gray(previewLines));
        console.log(chalk.gray("..."));
        console.log();
      }
    }

    // Actions
    console.log(chalk.bold("Actions:"));
    if (!installed) {
      console.log(chalk.white(`  Install:  sendai-skills install ${normalizedName}`));
    } else {
      console.log(chalk.white(`  Update:   sendai-skills update`));
      console.log(chalk.white(`  Remove:   sendai-skills remove ${normalizedName}`));
    }
    console.log();

    // GitHub link
    console.log(chalk.gray(`GitHub: https://github.com/sendaifun/skills/tree/main/skills/${normalizedName}`));
    console.log();
  } catch (error) {
    spinner.fail(`Skill "${normalizedName}" not found`);
    console.error(
      chalk.red(
        `\nError: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    console.log(chalk.gray("\nSearch for skills:"));
    console.log(chalk.white("  sendai-skills search <query>\n"));
    process.exit(1);
  }
}
