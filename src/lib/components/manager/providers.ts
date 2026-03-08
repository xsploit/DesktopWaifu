import { LlmClient } from '../../llm/client.js';
import { listFishModels } from '../../tts/fish-client.js';

export interface ProviderConfig {
	id: string;
	label: string;
	type: 'local' | 'cloud';
	category: 'llm' | 'tts';
	needsApiKey: boolean;
	needsEndpoint: boolean;
	defaultEndpoint?: string;
}

export interface ProviderDefaults {
	model: string;
	apiKey: string;
	endpoint: string;
}

export const LLM_PROVIDERS: ProviderConfig[] = [
	{ id: 'ollama', label: 'Ollama', type: 'local', category: 'llm', needsApiKey: false, needsEndpoint: true, defaultEndpoint: 'http://localhost:11434' },
	{ id: 'lmstudio', label: 'LM Studio', type: 'local', category: 'llm', needsApiKey: false, needsEndpoint: true, defaultEndpoint: 'http://localhost:1234' },
	{ id: 'openai', label: 'OpenAI', type: 'cloud', category: 'llm', needsApiKey: true, needsEndpoint: false },
	{ id: 'openrouter', label: 'OpenRouter', type: 'cloud', category: 'llm', needsApiKey: true, needsEndpoint: false },
];

export const TTS_PROVIDERS: ProviderConfig[] = [
	{ id: 'fish', label: 'Fish Audio', type: 'cloud', category: 'tts', needsApiKey: true, needsEndpoint: false },
	{ id: 'qwen', label: 'Qwen Local', type: 'local', category: 'tts', needsApiKey: false, needsEndpoint: true, defaultEndpoint: 'http://localhost:8880' },
];

export async function testLlmProvider(
	providerId: string,
	apiKey: string,
	endpoint: string
): Promise<{ ok: boolean; models: { id: string; name: string }[]; error?: string }> {
	try {
		const client = new LlmClient();
		client.provider = providerId as any;
		client.apiKey = apiKey;
		client.endpoint = endpoint;
		const models = await client.fetchModels();
		if (models.length > 0) {
			return { ok: true, models };
		}
		return { ok: false, models: [], error: 'No models found' };
	} catch (e: any) {
		return { ok: false, models: [], error: e.message };
	}
}

export async function testFishProvider(
	apiKey: string
): Promise<{ ok: boolean; count?: number; error?: string }> {
	try {
		const items = await listFishModels(apiKey);
		return { ok: true, count: items.length };
	} catch (e: any) {
		return { ok: false, error: e.message };
	}
}

export async function testQwenProvider(
	endpoint: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
	const raw = (endpoint || 'http://localhost:8880').trim();
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
	const base = withScheme.replace(/\/+$/, '');
	try {
		const res = await fetch(`${base}/v1/health`);
		if (!res.ok) {
			return { ok: false, error: `HTTP ${res.status}` };
		}
		const data = await res.json().catch(() => ({}));
		if (data?.ok) return { ok: true, message: 'Ready' };
		return { ok: false, error: data?.last_error || 'Not ready' };
	} catch (e: any) {
		return { ok: false, error: e.message };
	}
}
