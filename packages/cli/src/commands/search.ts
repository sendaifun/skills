import chalk from "chalk";
import ora from "ora";
import { access } from "fs/promises";
import { fetchSkillsList, fetchSkillMetadata } from "../utils/github.js";
import { getSkillInstallPath } from "../utils/paths.js";

interface SearchResult {
  name: string;
  description: string;
  installed: boolean;
  matchType: "name" | "description" | "content";
  score: number;
}

/**
 * Calculate match score for ranking results
 */
function calculateScore(
  query: string,
  skill: { name: string; description: string },
  matchType: "name" | "description" | "content"
): number {
  const lowerQuery = query.toLowerCase();
  const lowerName = skill.name.toLowerCase();
  const lowerDesc = skill.description.toLowerCase();

  let score = 0;

  // Exact name match gets highest score
  if (lowerName === lowerQuery) {
    score += 100;
  } else if (lowerName.includes(lowerQuery)) {
    score += 50;
  }

  // Description match
  if (lowerDesc.includes(lowerQuery)) {
    score += 25;
  }

  // Word boundary matches score higher
  const queryWords = lowerQuery.split(/\s+/);
  for (const word of queryWords) {
    if (lowerName.includes(word)) score += 10;
    if (lowerDesc.includes(word)) score += 5;
  }

  // Match type bonus
  if (matchType === "name") score += 20;
  if (matchType === "description") score += 10;

  return score;
}

export async function searchCommand(query: string): Promise<void> {
  if (!query || query.trim().length === 0) {
    console.log(chalk.yellow("Please provide a search query."));
    console.log(chalk.gray("Usage: sendai-skills search <query>"));
    console.log(chalk.gray("Example: sendai-skills search defi"));
    process.exit(1);
  }

  const spinner = ora(`Searching for "${query}"...`).start();

  try {
    const skills = await fetchSkillsList();
    const lowerQuery = query.toLowerCase();

    // Search through skills
    const results: SearchResult[] = [];

    for (const skill of skills) {
      const lowerName = skill.name.toLowerCase();
      const lowerDesc = skill.description.toLowerCase();

      let matchType: "name" | "description" | "content" | null = null;

      // Check name match
      if (lowerName.includes(lowerQuery)) {
        matchType = "name";
      }
      // Check description match
      else if (lowerDesc.includes(lowerQuery)) {
        matchType = "description";
      }
      // Check for word matches in description
      else {
        const queryWords = lowerQuery.split(/\s+/);
        for (const word of queryWords) {
          if (word.length >= 3 && (lowerName.includes(word) || lowerDesc.includes(word))) {
            matchType = "description";
            break;
          }
        }
      }

      if (matchType) {
        // Check if installed
        let installed = false;
        try {
          await access(getSkillInstallPath(skill.name));
          installed = true;
        } catch {
          installed = false;
        }

        results.push({
          name: skill.name,
          description: skill.description,
          installed,
          matchType,
          score: calculateScore(query, skill, matchType),
        });
      }
    }

    spinner.stop();

    if (results.length === 0) {
      console.log(chalk.yellow(`\nNo skills found matching "${query}"\n`));
      console.log(chalk.gray("Try a different search term or browse all skills:"));
      console.log(chalk.white("  sendai-skills list\n"));
      return;
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    console.log(chalk.bold(`\nFound ${results.length} skill(s) matching "${query}":\n`));

    for (const result of results) {
      const status = result.installed
        ? chalk.green(" [installed]")
        : "";
      const matchIndicator =
        result.matchType === "name"
          ? chalk.cyan("•")
          : chalk.gray("•");

      console.log(`${matchIndicator} ${chalk.bold(result.name)}${status}`);
      console.log(chalk.gray(`  ${result.description}\n`));
    }

    console.log(chalk.gray("Install a skill:"));
    console.log(chalk.white(`  sendai-skills install <skill-name>\n`));

    console.log(chalk.gray("Get detailed info:"));
    console.log(chalk.white(`  sendai-skills info <skill-name>\n`));
  } catch (error) {
    spinner.fail("Search failed");
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    process.exit(1);
  }
}
