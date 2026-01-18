import matter from "gray-matter";

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

export interface SkillContent {
  metadata: SkillMetadata;
  content: string;
  resources: ResourceFile[];
}

export interface ResourceFile {
  name: string;
  path: string;
  uri: string;
}

/**
 * Fetch the list of available skills from GitHub
 */
export async function fetchSkillsList(): Promise<SkillMetadata[]> {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/skills`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-mcp",
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
      "User-Agent": "sendai-skills-mcp",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch skill metadata: ${response.statusText}`);
  }

  const rawContent = await response.text();
  const { data } = matter(rawContent);

  return {
    name: (data.name as string) || skillName,
    description: (data.description as string) || "No description available",
    path: `skills/${skillName}`,
  };
}

/**
 * Fetch the complete content of a skill
 */
export async function fetchSkillContent(
  skillName: string
): Promise<SkillContent> {
  const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/skills/${skillName}/SKILL.md`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "sendai-skills-mcp",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch skill content: ${response.statusText}`);
  }

  const rawContent = await response.text();
  const { data, content } = matter(rawContent);

  const metadata: SkillMetadata = {
    name: (data.name as string) || skillName,
    description: (data.description as string) || "No description available",
    path: `skills/${skillName}`,
  };

  // Fetch resources for this skill
  const resources = await fetchSkillResources(skillName);

  return {
    metadata,
    content,
    resources,
  };
}

/**
 * Fetch list of resource files for a skill
 */
export async function fetchSkillResources(
  skillName: string
): Promise<ResourceFile[]> {
  const resources: ResourceFile[] = [];
  const directories = ["resources", "docs", "examples", "templates"];

  for (const dir of directories) {
    try {
      const dirResources = await fetchDirectoryResources(skillName, dir);
      resources.push(...dirResources);
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return resources;
}

/**
 * Fetch resources from a specific directory
 */
async function fetchDirectoryResources(
  skillName: string,
  directory: string
): Promise<ResourceFile[]> {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/skills/${skillName}/${directory}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sendai-skills-mcp",
    },
  });

  if (!response.ok) {
    return [];
  }

  const contents = (await response.json()) as Array<{
    name: string;
    type: string;
    path: string;
  }>;

  const resources: ResourceFile[] = [];

  for (const item of contents) {
    if (item.type === "file") {
      resources.push({
        name: item.name,
        path: item.path,
        uri: `sendai://${skillName}/${directory}/${item.name}`,
      });
    }
  }

  return resources;
}

/**
 * Fetch raw content of a resource file
 */
export async function fetchResourceContent(
  skillName: string,
  resourcePath: string
): Promise<string> {
  const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/skills/${skillName}/${resourcePath}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "sendai-skills-mcp",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch resource: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Cache for skills to avoid repeated API calls
 */
class SkillsCache {
  private skillsList: SkillMetadata[] | null = null;
  private skillsContent: Map<string, SkillContent> = new Map();
  private cacheTime: number = 0;
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes

  async getSkillsList(): Promise<SkillMetadata[]> {
    if (this.skillsList && Date.now() - this.cacheTime < this.cacheTTL) {
      return this.skillsList;
    }

    this.skillsList = await fetchSkillsList();
    this.cacheTime = Date.now();
    return this.skillsList;
  }

  async getSkillContent(skillName: string): Promise<SkillContent> {
    const cached = this.skillsContent.get(skillName);
    if (cached) {
      return cached;
    }

    const content = await fetchSkillContent(skillName);
    this.skillsContent.set(skillName, content);
    return content;
  }

  clear(): void {
    this.skillsList = null;
    this.skillsContent.clear();
    this.cacheTime = 0;
  }
}

export const skillsCache = new SkillsCache();
