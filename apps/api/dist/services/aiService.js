"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAiConfigured = isAiConfigured;
exports.generateMotdWithAi = generateMotdWithAi;
exports.generateLogoWithAi = generateLogoWithAi;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../utils/prisma");
async function getOpenAiKey() {
    const row = await prisma_1.prisma.setting.findUnique({ where: { key: 'ai.openaiKey' } });
    return row?.value || null;
}
async function isAiConfigured() {
    return !!(await getOpenAiKey());
}
async function generateMotdWithAi(serverName, theme, count = 5) {
    const apiKey = await getOpenAiKey();
    if (!apiKey)
        throw new Error('OpenAI API key not configured');
    const prompt = `Generate ${count} creative Minecraft server MOTDs (message of the day) for a server named "${serverName || 'My Server'}" with a "${theme}" theme.
Each MOTD must be exactly 2 lines, using Minecraft "§" formatting codes (e.g. §a for green, §l for bold, §r to reset).
Return ONLY a JSON array of ${count} strings, each string containing the 2 lines separated by a literal "\\n". No markdown, no explanation.`;
    const { data } = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
    }, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 });
    const content = data.choices?.[0]?.message?.content || '[]';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    if (!Array.isArray(parsed))
        throw new Error('Unexpected AI response format');
    return parsed.slice(0, count);
}
async function generateLogoWithAi(serverName, count = 3) {
    const apiKey = await getOpenAiKey();
    if (!apiKey)
        throw new Error('OpenAI API key not configured');
    const prompt = `A minimalist, modern logo icon for a Minecraft game server named "${serverName || 'My Server'}". Flat vector style, bold geometric shape, simple color palette, centered composition, no text, suitable for a small square app icon.`;
    const images = [];
    for (let i = 0; i < count; i++) {
        const { data } = await axios_1.default.post('https://api.openai.com/v1/images/generations', { model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 });
        const b64 = data.data?.[0]?.b64_json;
        if (b64)
            images.push(b64);
    }
    if (images.length === 0)
        throw new Error('AI image generation returned no results');
    return images;
}
//# sourceMappingURL=aiService.js.map