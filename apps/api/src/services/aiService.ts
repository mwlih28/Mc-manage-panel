import axios from 'axios';
import { prisma } from '../utils/prisma';

export type AiProvider = 'openai' | 'gemini' | 'anthropic';

const PROVIDER_KEY_SETTING: Record<AiProvider, string> = {
  openai: 'ai.openaiKey',
  gemini: 'ai.geminiKey',
  anthropic: 'ai.anthropicKey',
};

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value || null;
}

async function getActiveProvider(): Promise<AiProvider> {
  const value = await getSetting('ai.provider');
  return (value === 'gemini' || value === 'anthropic') ? value : 'openai';
}

async function getKeyFor(provider: AiProvider): Promise<string | null> {
  return getSetting(PROVIDER_KEY_SETTING[provider]);
}

function extractJsonArray(text: string): string[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  if (!Array.isArray(parsed)) throw new Error('Unexpected AI response format');
  return parsed;
}

function motdPrompt(serverName: string, theme: string, count: number): string {
  return `Generate ${count} creative Minecraft server MOTDs (message of the day) for a server named "${serverName || 'My Server'}" with a "${theme}" theme.
Each MOTD must be exactly 2 lines, using Minecraft "§" formatting codes (e.g. §a for green, §l for bold, §r to reset).
Return ONLY a JSON array of ${count} strings, each string containing the 2 lines separated by a literal "\\n". No markdown, no explanation.`;
}

async function generateMotdOpenAi(apiKey: string, serverName: string, theme: string, count: number): Promise<string[]> {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: motdPrompt(serverName, theme, count) }], temperature: 0.9 },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 }
  );
  return extractJsonArray(data.choices?.[0]?.message?.content || '[]');
}

async function generateMotdAnthropic(apiKey: string, serverName: string, theme: string, count: number): Promise<string[]> {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: motdPrompt(serverName, theme, count) }],
    },
    { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeout: 30000 }
  );
  return extractJsonArray(data.content?.[0]?.text || '[]');
}

async function generateMotdGemini(apiKey: string, serverName: string, theme: string, count: number): Promise<string[]> {
  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    { contents: [{ parts: [{ text: motdPrompt(serverName, theme, count) }] }] },
    { timeout: 30000 }
  );
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  return extractJsonArray(text);
}

export async function isAiConfigured(): Promise<boolean> {
  const provider = await getActiveProvider();
  return !!(await getKeyFor(provider));
}

export async function generateMotdWithAi(serverName: string, theme: string, count = 5): Promise<string[]> {
  const provider = await getActiveProvider();
  const apiKey = await getKeyFor(provider);
  if (!apiKey) throw new Error(`${provider} API key not configured`);

  const result = provider === 'anthropic'
    ? await generateMotdAnthropic(apiKey, serverName, theme, count)
    : provider === 'gemini'
      ? await generateMotdGemini(apiKey, serverName, theme, count)
      : await generateMotdOpenAi(apiKey, serverName, theme, count);

  return result.slice(0, count);
}

async function generateLogoOpenAi(apiKey: string, prompt: string, count: number): Promise<string[]> {
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
  return images;
}

async function generateLogoGemini(apiKey: string, prompt: string, count: number): Promise<string[]> {
  const images: string[] = [];
  for (let i = 0; i < count; i++) {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
      { timeout: 60000 }
    );
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
    if (imagePart?.inlineData?.data) images.push(imagePart.inlineData.data);
  }
  return images;
}

export async function generateLogoWithAi(serverName: string, count = 3): Promise<string[]> {
  const provider = await getActiveProvider();
  if (provider === 'anthropic') throw new Error('Anthropic does not support image generation — pick OpenAI or Gemini for the Logo Generator');
  const apiKey = await getKeyFor(provider);
  if (!apiKey) throw new Error(`${provider} API key not configured`);

  const prompt = `A minimalist, modern logo icon for a Minecraft game server named "${serverName || 'My Server'}". Flat vector style, bold geometric shape, simple color palette, centered composition, no text, suitable for a small square app icon.`;

  const images = provider === 'gemini'
    ? await generateLogoGemini(apiKey, prompt, count)
    : await generateLogoOpenAi(apiKey, prompt, count);

  if (images.length === 0) throw new Error('AI image generation returned no results');
  return images;
}
