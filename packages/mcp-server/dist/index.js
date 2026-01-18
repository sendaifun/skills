#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { skillsCache, fetchResourceContent, } from "./skills.js";
// Parse command line arguments
const args = process.argv.slice(2);
let selectedSkills = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skills" && args[i + 1]) {
        selectedSkills = args[i + 1].split(",").map((s) => s.trim().toLowerCase());
        break;
    }
}
// Create MCP server
const server = new Server({
    name: "sendai-skills-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        prompts: {},
        resources: {},
        tools: {},
    },
});
/**
 * Filter skills based on command line selection
 */
function filterSkills(skills) {
    if (!selectedSkills) {
        return skills;
    }
    return skills.filter((s) => selectedSkills.includes(s.name.toLowerCase()));
}
/**
 * List available prompts (skills as prompts)
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const allSkills = await skillsCache.getSkillsList();
    const skills = filterSkills(allSkills);
    return {
        prompts: skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
        })),
    };
});
/**
 * Get a specific prompt (skill content)
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const skillName = request.params.name;
    try {
        const skillContent = await skillsCache.getSkillContent(skillName);
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: skillContent.content,
                    },
                },
            ],
        };
    }
    catch (error) {
        throw new Error(`Skill "${skillName}" not found: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
});
/**
 * List available resources (skill supporting files)
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const allSkills = await skillsCache.getSkillsList();
    const skills = filterSkills(allSkills);
    const resources = [];
    for (const skill of skills) {
        try {
            const content = await skillsCache.getSkillContent(skill.name);
            for (const resource of content.resources) {
                resources.push({
                    uri: resource.uri,
                    name: `${skill.name}/${resource.name}`,
                    description: `Resource file from ${skill.name} skill`,
                    mimeType: getMimeType(resource.name),
                });
            }
        }
        catch {
            // Skip skills that fail to load
        }
    }
    return { resources };
});
/**
 * Read a specific resource
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    // Parse URI: sendai://skillName/directory/filename
    const match = uri.match(/^sendai:\/\/([^/]+)\/(.+)$/);
    if (!match) {
        throw new Error(`Invalid resource URI: ${uri}`);
    }
    const [, skillName, resourcePath] = match;
    try {
        const content = await fetchResourceContent(skillName, resourcePath);
        return {
            contents: [
                {
                    uri,
                    mimeType: getMimeType(resourcePath),
                    text: content,
                },
            ],
        };
    }
    catch (error) {
        throw new Error(`Failed to read resource: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
});
/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "list_skills",
                description: "List all available SendAI Solana development skills",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
            {
                name: "get_skill",
                description: "Get the full content of a specific SendAI skill for Solana development",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "The skill name (e.g., kamino, raydium, helius, drift-protocol)",
                        },
                    },
                    required: ["name"],
                },
            },
            {
                name: "get_skill_resource",
                description: "Get a specific resource file from a SendAI skill (examples, templates, docs)",
                inputSchema: {
                    type: "object",
                    properties: {
                        skill: {
                            type: "string",
                            description: "The skill name",
                        },
                        resource: {
                            type: "string",
                            description: "The resource path (e.g., resources/api-reference.md, examples/basic.ts)",
                        },
                    },
                    required: ["skill", "resource"],
                },
            },
        ],
    };
});
/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case "list_skills": {
            const allSkills = await skillsCache.getSkillsList();
            const skills = filterSkills(allSkills);
            const skillsList = skills
                .map((s) => `- **${s.name}**: ${s.description}`)
                .join("\n");
            return {
                content: [
                    {
                        type: "text",
                        text: `# Available SendAI Skills\n\n${skillsList}\n\nUse the \`get_skill\` tool to get the full content of a specific skill.`,
                    },
                ],
            };
        }
        case "get_skill": {
            const skillName = args.name;
            if (!skillName) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: skill name is required",
                        },
                    ],
                    isError: true,
                };
            }
            try {
                const skillContent = await skillsCache.getSkillContent(skillName);
                let response = `# ${skillContent.metadata.name}\n\n`;
                response += `${skillContent.metadata.description}\n\n`;
                response += skillContent.content;
                if (skillContent.resources.length > 0) {
                    response += "\n\n## Available Resources\n\n";
                    response += skillContent.resources
                        .map((r) => `- ${r.uri}`)
                        .join("\n");
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: response,
                        },
                    ],
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Failed to fetch skill "${skillName}": ${error instanceof Error ? error.message : "Unknown error"}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
        case "get_skill_resource": {
            const { skill, resource } = args;
            if (!skill || !resource) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: both skill and resource parameters are required",
                        },
                    ],
                    isError: true,
                };
            }
            try {
                const content = await fetchResourceContent(skill, resource);
                return {
                    content: [
                        {
                            type: "text",
                            text: content,
                        },
                    ],
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Failed to fetch resource: ${error instanceof Error ? error.message : "Unknown error"}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
        default:
            return {
                content: [
                    {
                        type: "text",
                        text: `Unknown tool: ${name}`,
                    },
                ],
                isError: true,
            };
    }
});
/**
 * Get MIME type for a file
 */
function getMimeType(filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "md":
            return "text/markdown";
        case "json":
            return "application/json";
        case "ts":
        case "tsx":
            return "text/typescript";
        case "js":
        case "jsx":
            return "text/javascript";
        case "yaml":
        case "yml":
            return "text/yaml";
        default:
            return "text/plain";
    }
}
/**
 * Start the server
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log startup info to stderr (not stdout, which is used for MCP)
    console.error("SendAI Skills MCP Server started");
    if (selectedSkills) {
        console.error(`Serving skills: ${selectedSkills.join(", ")}`);
    }
    else {
        console.error("Serving all available skills");
    }
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map