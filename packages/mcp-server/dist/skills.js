import matter from "gray-matter";
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
const REPO_OWNER = "sendaifun";
const REPO_NAME = "skills";
const DEFAULT_BRANCH = "main";
/**
 * Fetch the list of available skills from GitHub
 */
export async function fetchSkillsList() {
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
    const contents = (await response.json());
    const skills = [];
    for (const item of contents) {
        if (item.type === "dir") {
            try {
                const metadata = await fetchSkillMetadata(item.name);
                skills.push(metadata);
            }
            catch {
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
export async function fetchSkillMetadata(skillName) {
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
        name: data.name || skillName,
        description: data.description || "No description available",
        path: `skills/${skillName}`,
    };
}
/**
 * Fetch the complete content of a skill
 */
export async function fetchSkillContent(skillName) {
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
    const metadata = {
        name: data.name || skillName,
        description: data.description || "No description available",
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
export async function fetchSkillResources(skillName) {
    const resources = [];
    const directories = ["resources", "docs", "examples", "templates"];
    for (const dir of directories) {
        try {
            const dirResources = await fetchDirectoryResources(skillName, dir);
            resources.push(...dirResources);
        }
        catch {
            // Directory doesn't exist, skip
        }
    }
    return resources;
}
/**
 * Fetch resources from a specific directory
 */
async function fetchDirectoryResources(skillName, directory) {
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
    const contents = (await response.json());
    const resources = [];
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
export async function fetchResourceContent(skillName, resourcePath) {
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
    skillsList = null;
    skillsContent = new Map();
    cacheTime = 0;
    cacheTTL = 5 * 60 * 1000; // 5 minutes
    async getSkillsList() {
        if (this.skillsList && Date.now() - this.cacheTime < this.cacheTTL) {
            return this.skillsList;
        }
        this.skillsList = await fetchSkillsList();
        this.cacheTime = Date.now();
        return this.skillsList;
    }
    async getSkillContent(skillName) {
        const cached = this.skillsContent.get(skillName);
        if (cached) {
            return cached;
        }
        const content = await fetchSkillContent(skillName);
        this.skillsContent.set(skillName, content);
        return content;
    }
    clear() {
        this.skillsList = null;
        this.skillsContent.clear();
        this.cacheTime = 0;
    }
}
export const skillsCache = new SkillsCache();
//# sourceMappingURL=skills.js.map