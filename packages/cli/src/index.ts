#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { listCommand } from "./commands/list.js";
import { installCommand } from "./commands/install.js";
import { removeCommand } from "./commands/remove.js";
import { updateCommand } from "./commands/update.js";

const program = new Command();

program
  .name("sendai-skills")
  .description("CLI to install SendAI Solana skills for Claude Code")
  .version("1.0.0");

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
  program.help();
}

program.parse();
