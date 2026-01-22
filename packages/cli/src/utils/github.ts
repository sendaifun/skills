import { mkdir, writeFile, readdir, readFile, stat, rm } from "fs/promises";
import { join, dirname } from "path";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
const REPO_OWNER = "sendaifun";
const REPO_NAME = "skills";
const DEFAULT_BRANCH = "main";

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

export interface SkillManifest {
  skills: SkillMetadata[];
}

/**
 * Fetch the list of available skills from GitHub
 */
export async function fetchSkillsList(): Promise<SkillMetadata[]> {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/skills`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch skills list: ${response.statusText}`);
  }

  const contents = (await response.json()) as Array<{
    name: string;
    type: string;
    path: string;
  }>;

  const skills: SkillMetadata[] = [];

  for (const item of contents) {
    if (item.type === "dir") {
      try {
        const metadata = await fetchSkillMetadata(item.name);
        skills.push(metadata);
      } catch {
        // Skip skills without proper SKILL.md
        skills.push({
          name: item.name,
          description: "No description available",
          path: item.path,
        });
      }
    }
  }

  return skills;
}

/**
 * Fetch metadata for a specific skill from its SKILL.md frontmatter
 */
export async function fetchSkillMetadata(
  skillName: string
): Promise<SkillMetadata> {
  const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/skills/${skillName}/SKILL.md`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "sendai-skills-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch skill metadata: ${response.statusText}`);
  }

  const content = await response.text();
  const metadata = parseSkillFrontmatter(content);

  return {
    name: metadata.name || skillName,
    description: metadata.description || "No description available",
    path: `skills/${skillName}`,
  };
}

/**
 * Parse YAML frontmatter from SKILL.md content
 */
function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: { name?: string; description?: string } = {};

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }

  return result;
}

/**
 * Download a complete skill directory from GitHub
 */
export async function downloadSkill(
  skillName: string,
  targetDir: string
): Promise<void> {
  const skillPath = `skills/${skillName}`;

  // Get all files in the skill directory recursively
  const files = await fetchDirectoryContents(skillPath);

  // Create target directory
  await mkdir(targetDir, { recursive: true });

  // Download each file
  for (const file of files) {
    const relativePath = file.path.replace(`${skillPath}/`, "");
    const targetPath = join(targetDir, relativePath);

    // Create directory if needed
    await mkdir(dirname(targetPath), { recursive: true });

    // Download file content
    const content = await fetchFileContent(file.path);
    await writeFile(targetPath, content);
  }
}

/**
 * Recursively fetch all files in a directory from GitHub
 */
export async function fetchDirectoryContents(
  skillNameOrPath: string,
  subPath?: string
): Promise<Array<{ path: string; type: string; name: string }>> {
  // If subPath is provided, construct path as skills/skillName/subPath
  const path = subPath
    ? `skills/${skillNameOrPath}/${subPath}`
    : skillNameOrPath;
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch directory contents: ${response.statusText}`);
  }

  const contents = (await response.json()) as Array<{
    name: string;
    type: string;
    path: string;
  }>;

  const files: Array<{ path: string; type: string; name: string }> = [];

  for (const item of contents) {
    if (item.type === "file") {
      files.push({ path: item.path, type: "file", name: item.name });
    } else if (item.type === "dir") {
      const subFiles = await fetchDirectoryContents(item.path);
      files.push(...subFiles);
    }
  }

  return files;
}

/**
 * Fetch raw file content from GitHub
 */
async function fetchFileContent(path: string): Promise<string> {
  const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/${path}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "sendai-skills-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Check if a skill exists on GitHub
 */
export async function skillExists(skillName: string): Promise<boolean> {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/skills/${skillName}/SKILL.md`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-cli",
    },
  });

  return response.ok;
}
