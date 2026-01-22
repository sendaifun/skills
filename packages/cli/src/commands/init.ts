import chalk from "chalk";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import { fetchSkillsList } from "../utils/github.js";

const execAsync = promisify(exec);

interface InitOptions {
  skills?: string;
  local?: boolean;
  remove?: boolean;
}

/**
 * Check if Claude CLI is available
 */
async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    await execAsync("claude --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if MCP server is already configured
 */
async function isMcpConfigured(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("claude mcp list");
    return stdout.includes("sendai-skills");
  } catch {
    return false;
  }
}

/**
 * Remove existing MCP configuration
 */
async function removeMcpConfig(): Promise<void> {
  try {
    await execAsync("claude mcp remove sendai-skills");
  } catch {
    // Ignore errors if not configured
  }
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.bold("\nSendAI Skills - Claude Code Plugin Setup\n"));

  // Check if Claude CLI is available
  const spinner = ora("Checking Claude CLI availability...").start();
  const claudeAvailable = await isClaudeCliAvailable();

  if (!claudeAvailable) {
    spinner.fail("Claude CLI not found");
    console.log(chalk.red("\nClaude Code CLI is not installed or not in PATH."));
    console.log(chalk.gray("Install Claude Code from: https://claude.ai/code"));
    console.log(chalk.gray("\nAlternatively, you can manually configure the MCP server:"));
    console.log(chalk.cyan("\n  Add this to your Claude Code MCP settings:\n"));
    console.log(chalk.white('  {'));
    console.log(chalk.white('    "mcpServers": {'));
    console.log(chalk.white('      "sendai-skills": {'));
    console.log(chalk.white('        "command": "npx",'));
    console.log(chalk.white('        "args": ["sendai-skills-mcp"]'));
    console.log(chalk.white('      }'));
    console.log(chalk.white('    }'));
    console.log(chalk.white('  }\n'));
    process.exit(1);
  }

  spinner.succeed("Claude CLI found");

  // Handle remove option
  if (options.remove) {
    const removeSpinner = ora("Removing SendAI Skills from Claude Code...").start();
    await removeMcpConfig();
    removeSpinner.succeed("SendAI Skills removed from Claude Code");
    return;
  }

  // Check if already configured
  const alreadyConfigured = await isMcpConfigured();
  if (alreadyConfigured) {
    console.log(chalk.yellow("\nSendAI Skills is already configured in Claude Code."));
    console.log(chalk.gray("Use --remove to remove it, or continue to reconfigure.\n"));

    const reconfigureSpinner = ora("Reconfiguring...").start();
    await removeMcpConfig();
    reconfigureSpinner.succeed("Previous configuration removed");
  }

  // Build the MCP command
  let mcpArgs = ["sendai-skills-mcp"];

  if (options.skills) {
    mcpArgs.push("--skills", options.skills);
    console.log(chalk.gray(`\nConfiguring with selected skills: ${options.skills}`));
  } else {
    console.log(chalk.gray("\nConfiguring with all available skills..."));
  }

  // Show available skills count
  try {
    const skillsList = await fetchSkillsList();
    const skillCount = options.skills
      ? options.skills.split(",").length
      : skillsList.length;
    console.log(chalk.gray(`${skillCount} skill(s) will be available\n`));
  } catch {
    // Continue even if we can't fetch the count
  }

  // Add MCP server to Claude Code
  const addSpinner = ora("Adding SendAI Skills to Claude Code...").start();

  try {
    const command = options.local
      ? `claude mcp add sendai-skills -- node ${process.cwd()}/packages/mcp-server/dist/index.js${options.skills ? ` --skills ${options.skills}` : ""}`
      : `claude mcp add sendai-skills -- npx ${mcpArgs.join(" ")}`;

    await execAsync(command);
    addSpinner.succeed("SendAI Skills added to Claude Code");

    console.log(chalk.green("\n✓ Plugin marketplace configured successfully!\n"));
    console.log(chalk.bold("Next steps:"));
    console.log(chalk.gray("  1. Restart Claude Code or start a new session"));
    console.log(chalk.gray("  2. Ask Claude about Solana development"));
    console.log(chalk.gray("  3. Claude will automatically use the SendAI skills\n"));

    console.log(chalk.bold("Available commands in Claude Code:"));
    console.log(chalk.cyan("  • \"List all SendAI skills\""));
    console.log(chalk.cyan("  • \"Get the kamino skill\""));
    console.log(chalk.cyan("  • \"Help me build on Solana using Raydium\"\n"));

    console.log(chalk.gray("To verify the configuration:"));
    console.log(chalk.white("  claude mcp list\n"));
  } catch (error) {
    addSpinner.fail("Failed to add SendAI Skills to Claude Code");
    console.error(
      chalk.red(
        `\nError: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    console.log(chalk.gray("\nTry running manually:"));
    console.log(chalk.white(`  claude mcp add sendai-skills -- npx ${mcpArgs.join(" ")}\n`));
    process.exit(1);
  }
}
