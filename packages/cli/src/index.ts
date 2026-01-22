#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { listCommand } from "./commands/list.js";
import { installCommand } from "./commands/install.js";
import { removeCommand } from "./commands/remove.js";
import { updateCommand } from "./commands/update.js";
import { initCommand } from "./commands/init.js";
import { searchCommand } from "./commands/search.js";
import { infoCommand } from "./commands/info.js";
import { pluginCommand } from "./commands/plugin.js";

const program = new Command();

program
  .name("sendai-skills")
  .description("CLI to install SendAI Solana skills for Claude Code")
  .version("1.0.0");

// Plugin marketplace commands
program
  .command("init")
  .description("Configure SendAI Skills as a Claude Code plugin (MCP server)")
  .option("-s, --skills <skills>", "Comma-separated list of skills to enable")
  .option("-l, --local", "Use local MCP server (for development)")
  .option("-r, --remove", "Remove SendAI Skills from Claude Code")
  .action(initCommand);

program
  .command("plugin <action> [args...]")
  .description("Manage plugins from the marketplace (list, install, remove, info)")
  .action(pluginCommand);

program
  .command("search <query>")
  .description("Search for skills by keyword")
  .action(searchCommand);

program
  .command("info <skill>")
  .description("Show detailed information about a skill")
  .action(infoCommand);

// Skill management commands
program
  .command("list")
  .description("List all available SendAI skills")
  .action(listCommand);

program
  .command("install [skills...]")
  .description("Install SendAI skills to Claude Code")
  .option("-a, --all", "Install all available skills")
  .action(installCommand);

program
  .command("remove <skills...>")
  .description("Remove installed SendAI skills")
  .action(removeCommand);

program
  .command("update")
  .description("Update all installed SendAI skills")
  .action(updateCommand);

// Show help if no command is provided
if (process.argv.length <= 2) {
  console.log(chalk.bold("\nSendAI Skills - Solana development skills for Claude Code\n"));
  console.log(chalk.cyan("Plugin Marketplace:"));
  console.log(chalk.gray("  Use 'npx sendai-skills plugin list' to browse plugins"));
  console.log(chalk.gray("  Use 'npx sendai-skills plugin install <plugin>' to install a plugin"));
  console.log(chalk.gray("  Use 'npx sendai-skills init' to add MCP server to Claude Code"));
  console.log();
  program.help();
}

program.parse();
