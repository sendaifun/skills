import { homedir } from "os";
import { join } from "path";

/**
 * Get the Claude Code skills directory
 */
export function getClaudeSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

/**
 * Get the path for a specific SendAI skill installation
 */
export function getSkillInstallPath(skillName: string): string {
  return join(getClaudeSkillsDir(), `sendai-${skillName}`);
}

/**
 * Normalize skill name (lowercase, trimmed)
 */
export function normalizeSkillName(name: string): string {
  return name.toLowerCase().trim();
}
