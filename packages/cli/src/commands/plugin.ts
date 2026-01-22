import chalk from "chalk";
import ora from "ora";
import { mkdir, writeFile, readFile, access, rm, readdir, cp } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { getClaudeSkillsDir } from "../utils/paths.js";

const execAsync = promisify(exec);

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
const REPO_OWNER = "sendaifun";
const REPO_NAME = "skills";
const DEFAULT_BRANCH = "main";

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  skills: string[];
  commands?: string[];
  agents?: string[];
  mcp?: {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  dependencies?: {
    npm?: string[];
  };
  setup?: {
    env?: Array<{
      name: string;
      description: string;
      required: boolean;
      secret?: boolean;
      default?: string;
    }>;
  };
}

interface PluginInfo {
  name: string;
  description: string;
  installed: boolean;
}

/**
 * Get the plugins installation directory
 */
function getPluginsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".claude", "plugins");
}

/**
 * Get the Claude commands directory
 */
function getCommandsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".claude", "commands");
}

/**
 * Get the Claude agents directory
 */
function getAgentsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".claude", "agents");
}

/**
 * Fetch the list of available plugins from GitHub
 */
async function fetchPluginsList(): Promise<PluginInfo[]> {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/plugins`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch plugins list: ${response.statusText}`);
  }

  const contents = (await response.json()) as Array<{
    name: string;
    type: string;
  }>;

  const plugins: PluginInfo[] = [];

  for (const item of contents) {
    if (item.type === "dir") {
      try {
        const manifest = await fetchPluginManifest(item.name);
        const installed = await isPluginInstalled(item.name);
        plugins.push({
          name: manifest.name,
          description: manifest.description,
          installed,
        });
      } catch {
        plugins.push({
          name: item.name,
          description: "No description available",
          installed: false,
        });
      }
    }
  }

  return plugins;
}

/**
 * Fetch plugin manifest from GitHub
 */
async function fetchPluginManifest(pluginName: string): Promise<PluginManifest> {
  const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/plugins/${pluginName}/PLUGIN.json`;

  const response = await fetch(url, {
    headers: { "User-Agent": "sendai-skills-cli" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch plugin manifest: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check if a plugin is installed
 */
async function isPluginInstalled(pluginName: string): Promise<boolean> {
  try {
    const pluginsDir = getPluginsDir();
    await access(join(pluginsDir, pluginName));
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a file from GitHub
 */
async function downloadFile(path: string): Promise<string> {
  const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/${path}`;

  const response = await fetch(url, {
    headers: { "User-Agent": "sendai-skills-cli" },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Download directory contents from GitHub
 */
async function downloadDirectory(
  path: string,
  targetDir: string
): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-cli",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return; // Directory doesn't exist, skip
    }
    throw new Error(`Failed to fetch directory: ${response.statusText}`);
  }

  const contents = (await response.json()) as Array<{
    name: string;
    type: string;
    path: string;
  }>;

  await mkdir(targetDir, { recursive: true });

  for (const item of contents) {
    if (item.type === "file") {
      const content = await downloadFile(item.path);
      await writeFile(join(targetDir, item.name), content);
    } else if (item.type === "dir") {
      await downloadDirectory(item.path, join(targetDir, item.name));
    }
  }
}

/**
 * Install a plugin
 */
async function installPlugin(pluginName: string): Promise<void> {
  const spinner = ora(`Installing plugin "${pluginName}"...`).start();

  try {
    // Fetch plugin manifest
    const manifest = await fetchPluginManifest(pluginName);
    spinner.text = `Installing ${manifest.name} v${manifest.version}...`;

    // Create directories
    const pluginsDir = getPluginsDir();
    const pluginDir = join(pluginsDir, pluginName);
    const skillsDir = getClaudeSkillsDir();
    const commandsDir = getCommandsDir();
    const agentsDir = getAgentsDir();

    await mkdir(pluginDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(commandsDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });

    // Save manifest
    await writeFile(
      join(pluginDir, "PLUGIN.json"),
      JSON.stringify(manifest, null, 2)
    );

    // Download and install skills
    spinner.text = "Installing skills...";
    for (const skillName of manifest.skills) {
      const skillTargetDir = join(skillsDir, `sendai-${skillName}`);
      await downloadDirectory(`skills/${skillName}`, skillTargetDir);
    }

    // Download and install commands
    if (manifest.commands && manifest.commands.length > 0) {
      spinner.text = "Installing commands...";
      for (const cmdName of manifest.commands) {
        const cmdContent = await downloadFile(
          `plugins/${pluginName}/commands/${cmdName}.md`
        );
        await writeFile(
          join(commandsDir, `${pluginName}-${cmdName}.md`),
          cmdContent
        );
      }
    }

    // Download and install agents
    if (manifest.agents && manifest.agents.length > 0) {
      spinner.text = "Installing agents...";
      for (const agentName of manifest.agents) {
        const agentContent = await downloadFile(
          `plugins/${pluginName}/agents/${agentName}.md`
        );
        await writeFile(
          join(agentsDir, `${pluginName}-${agentName}.md`),
          agentContent
        );
      }
    }

    // Configure MCP server if defined
    if (manifest.mcp) {
      spinner.text = "Configuring MCP server...";
      try {
        // Check if Claude CLI is available
        await execAsync("claude --version");

        // Remove existing config if any
        try {
          await execAsync(`claude mcp remove ${manifest.mcp.name}`);
        } catch {
          // Ignore if not configured
        }

        // Add MCP server
        const mcpArgs = manifest.mcp.args.join(" ");
        await execAsync(
          `claude mcp add ${manifest.mcp.name} -- ${manifest.mcp.command} ${mcpArgs}`
        );
      } catch {
        // Claude CLI not available, show manual instructions later
      }
    }

    spinner.succeed(`Plugin "${manifest.name}" installed successfully!`);

    // Show post-install information
    console.log();
    console.log(chalk.bold("Installed components:"));
    console.log(chalk.gray(`  Skills: ${manifest.skills.join(", ")}`));
    if (manifest.commands && manifest.commands.length > 0) {
      console.log(
        chalk.gray(`  Commands: /${manifest.commands.map((c) => `${pluginName}-${c}`).join(", /")}`)
      );
    }
    if (manifest.agents && manifest.agents.length > 0) {
      console.log(chalk.gray(`  Agents: ${manifest.agents.join(", ")}`));
    }
    if (manifest.mcp) {
      console.log(chalk.gray(`  MCP Server: ${manifest.mcp.name}`));
    }

    // Show environment setup if needed
    if (manifest.setup?.env && manifest.setup.env.length > 0) {
      console.log();
      console.log(chalk.yellow("Required environment variables:"));
      for (const env of manifest.setup.env) {
        const required = env.required ? chalk.red("*") : "";
        const defaultVal = env.default ? ` (default: ${env.default})` : "";
        console.log(chalk.gray(`  ${env.name}${required}: ${env.description}${defaultVal}`));
      }
      console.log();
      console.log(chalk.gray("Add these to your .env file or shell environment."));
    }

    console.log();
    console.log(chalk.gray("Restart Claude Code to activate the plugin."));
  } catch (error) {
    spinner.fail(`Failed to install plugin "${pluginName}"`);
    throw error;
  }
}

/**
 * Remove a plugin
 */
async function removePlugin(pluginName: string): Promise<void> {
  const spinner = ora(`Removing plugin "${pluginName}"...`).start();

  try {
    const pluginsDir = getPluginsDir();
    const pluginDir = join(pluginsDir, pluginName);

    // Read manifest to know what to clean up
    let manifest: PluginManifest | null = null;
    try {
      const manifestContent = await readFile(
        join(pluginDir, "PLUGIN.json"),
        "utf-8"
      );
      manifest = JSON.parse(manifestContent);
    } catch {
      // Manifest not found, just remove the plugin directory
    }

    if (manifest) {
      // Remove skills
      const skillsDir = getClaudeSkillsDir();
      for (const skillName of manifest.skills) {
        try {
          await rm(join(skillsDir, `sendai-${skillName}`), { recursive: true });
        } catch {
          // Skill not found, skip
        }
      }

      // Remove commands
      if (manifest.commands) {
        const commandsDir = getCommandsDir();
        for (const cmdName of manifest.commands) {
          try {
            await rm(join(commandsDir, `${pluginName}-${cmdName}.md`));
          } catch {
            // Command not found, skip
          }
        }
      }

      // Remove agents
      if (manifest.agents) {
        const agentsDir = getAgentsDir();
        for (const agentName of manifest.agents) {
          try {
            await rm(join(agentsDir, `${pluginName}-${agentName}.md`));
          } catch {
            // Agent not found, skip
          }
        }
      }

      // Remove MCP server
      if (manifest.mcp) {
        try {
          await execAsync(`claude mcp remove ${manifest.mcp.name}`);
        } catch {
          // MCP not configured, skip
        }
      }
    }

    // Remove plugin directory
    await rm(pluginDir, { recursive: true });

    spinner.succeed(`Plugin "${pluginName}" removed successfully!`);
  } catch (error) {
    spinner.fail(`Failed to remove plugin "${pluginName}"`);
    throw error;
  }
}

/**
 * Show plugin info
 */
async function showPluginInfo(pluginName: string): Promise<void> {
  const spinner = ora(`Fetching info for "${pluginName}"...`).start();

  try {
    const manifest = await fetchPluginManifest(pluginName);
    const installed = await isPluginInstalled(pluginName);

    spinner.stop();

    console.log(chalk.bold(`\n${manifest.name} v${manifest.version}\n`));
    console.log(chalk.white(manifest.description));
    console.log();

    if (installed) {
      console.log(chalk.green("Status: Installed"));
    } else {
      console.log(chalk.yellow("Status: Not installed"));
    }
    console.log();

    console.log(chalk.bold("Components:"));
    console.log(chalk.cyan(`  Skills (${manifest.skills.length}):`));
    for (const skill of manifest.skills) {
      console.log(chalk.gray(`    - ${skill}`));
    }

    if (manifest.commands && manifest.commands.length > 0) {
      console.log(chalk.cyan(`  Commands (${manifest.commands.length}):`));
      for (const cmd of manifest.commands) {
        console.log(chalk.gray(`    - /${pluginName}-${cmd}`));
      }
    }

    if (manifest.agents && manifest.agents.length > 0) {
      console.log(chalk.cyan(`  Agents (${manifest.agents.length}):`));
      for (const agent of manifest.agents) {
        console.log(chalk.gray(`    - ${agent}`));
      }
    }

    if (manifest.mcp) {
      console.log(chalk.cyan("  MCP Server:"));
      console.log(chalk.gray(`    - ${manifest.mcp.name}`));
    }

    if (manifest.dependencies?.npm) {
      console.log(chalk.cyan(`  npm dependencies:`));
      for (const dep of manifest.dependencies.npm) {
        console.log(chalk.gray(`    - ${dep}`));
      }
    }

    console.log();

    if (!installed) {
      console.log(chalk.gray("Install:"));
      console.log(chalk.white(`  npx sendai-skills plugin install ${pluginName}`));
    } else {
      console.log(chalk.gray("Remove:"));
      console.log(chalk.white(`  npx sendai-skills plugin remove ${pluginName}`));
    }
    console.log();
  } catch (error) {
    spinner.fail(`Plugin "${pluginName}" not found`);
    throw error;
  }
}

/**
 * List all plugins
 */
async function listPlugins(): Promise<void> {
  const spinner = ora("Fetching available plugins...").start();

  try {
    const plugins = await fetchPluginsList();
    spinner.stop();

    console.log(chalk.bold("\nAvailable Plugins:\n"));

    for (const plugin of plugins) {
      const status = plugin.installed
        ? chalk.green(" [installed]")
        : "";
      console.log(`${chalk.cyan("•")} ${chalk.bold(plugin.name)}${status}`);
      console.log(chalk.gray(`  ${plugin.description}\n`));
    }

    console.log(chalk.gray("Install a plugin:"));
    console.log(chalk.white("  npx sendai-skills plugin install <plugin-name>"));
    console.log();
    console.log(chalk.gray("Get plugin info:"));
    console.log(chalk.white("  npx sendai-skills plugin info <plugin-name>"));
    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch plugins");
    throw error;
  }
}

interface PluginOptions {
  all?: boolean;
}

export async function pluginCommand(
  action: string,
  args: string[],
  options: PluginOptions
): Promise<void> {
  try {
    switch (action) {
      case "list":
        await listPlugins();
        break;

      case "install":
        if (args.length === 0) {
          console.log(chalk.yellow("Please specify a plugin to install."));
          console.log(chalk.gray("Usage: sendai-skills plugin install <plugin-name>"));
          console.log(chalk.gray("       sendai-skills plugin list"));
          process.exit(1);
        }
        for (const pluginName of args) {
          await installPlugin(pluginName);
        }
        break;

      case "remove":
        if (args.length === 0) {
          console.log(chalk.yellow("Please specify a plugin to remove."));
          console.log(chalk.gray("Usage: sendai-skills plugin remove <plugin-name>"));
          process.exit(1);
        }
        for (const pluginName of args) {
          await removePlugin(pluginName);
        }
        break;

      case "info":
        if (args.length === 0) {
          console.log(chalk.yellow("Please specify a plugin name."));
          console.log(chalk.gray("Usage: sendai-skills plugin info <plugin-name>"));
          process.exit(1);
        }
        await showPluginInfo(args[0]);
        break;

      default:
        console.log(chalk.yellow(`Unknown action: ${action}`));
        console.log(chalk.gray("Available actions: list, install, remove, info"));
        process.exit(1);
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
