import axios from 'axios';
import { prisma } from '../utils/prisma';

async function getOpenAiKey(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'ai.openaiKey' } });
  return row?.value || null;
}

export async function isAiConfigured(): Promise<boolean> {
  return !!(await getOpenAiKey());
}

export async function generateMotdWithAi(serverName: string, theme: string, count = 5): Promise<string[]> {
  const apiKey = await getOpenAiKey();
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const prompt = `Generate ${count} creative Minecraft server MOTDs (message of the day) for a server named "${serverName || 'My Server'}" with a "${theme}" theme.
Each MOTD must be exactly 2 lines, using Minecraft "§" formatting codes (e.g. §a for green, §l for bold, §r to reset).
Return ONLY a JSON array of ${count} strings, each string containing the 2 lines separated by a literal "\\n". No markdown, no explanation.`;

  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 }
  );

  const content: string = data.choices?.[0]?.message?.content || '[]';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  if (!Array.isArray(parsed)) throw new Error('Unexpected AI response format');
  return parsed.slice(0, count);
}

export async function generateLogoWithAi(serverName: string, count = 3): Promise<string[]> {
  const apiKey = await getOpenAiKey();
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const prompt = `A minimalist, modern logo icon for a Minecraft game server named "${serverName || 'My Server'}". Flat vector style, bold geometric shape, simple color palette, centered composition, no text, suitable for a small square app icon.`;

  const images: string[] = [];
  for (let i = 0; i < count; i++) {
    const { data } = await axios.post(
      'https://api.openai.com/v1/images/generations',
      { model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
    );
    const b64: string | undefined = data.data?.[0]?.b64_json;
    if (b64) images.push(b64);
  }
  if (images.length === 0) throw new Error('AI image generation returned no results');
  return images;
}
