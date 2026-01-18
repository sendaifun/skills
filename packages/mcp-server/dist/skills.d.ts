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
export declare function fetchSkillsList(): Promise<SkillMetadata[]>;
/**
 * Fetch metadata for a specific skill from its SKILL.md frontmatter
 */
export declare function fetchSkillMetadata(skillName: string): Promise<SkillMetadata>;
/**
 * Fetch the complete content of a skill
 */
export declare function fetchSkillContent(skillName: string): Promise<SkillContent>;
/**
 * Fetch list of resource files for a skill
 */
export declare function fetchSkillResources(skillName: string): Promise<ResourceFile[]>;
/**
 * Fetch raw content of a resource file
 */
export declare function fetchResourceContent(skillName: string, resourcePath: string): Promise<string>;
/**
 * Cache for skills to avoid repeated API calls
 */
declare class SkillsCache {
    private skillsList;
    private skillsContent;
    private cacheTime;
    private readonly cacheTTL;
    getSkillsList(): Promise<SkillMetadata[]>;
    getSkillContent(skillName: string): Promise<SkillContent>;
    clear(): void;
}
export declare const skillsCache: SkillsCache;
export {};
//# sourceMappingURL=skills.d.ts.map