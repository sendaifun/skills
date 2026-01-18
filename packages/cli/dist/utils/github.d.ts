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
export declare function fetchSkillsList(): Promise<SkillMetadata[]>;
/**
 * Fetch metadata for a specific skill from its SKILL.md frontmatter
 */
export declare function fetchSkillMetadata(skillName: string): Promise<SkillMetadata>;
/**
 * Download a complete skill directory from GitHub
 */
export declare function downloadSkill(skillName: string, targetDir: string): Promise<void>;
/**
 * Check if a skill exists on GitHub
 */
export declare function skillExists(skillName: string): Promise<boolean>;
//# sourceMappingURL=github.d.ts.map