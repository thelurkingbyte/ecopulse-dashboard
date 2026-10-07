import type { BlackBoxEvent, SensorNode } from './engine';

/*
 * Gemini-backed AI situation analysis.
 *
 * NOTE: this is a static Vite SPA, so the API key is bundled into the
 * client (Vite only exposes variables prefixed with VITE_). Do not ship
 * a key with broad permissions to a public deployment.
 */
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const MODEL = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? 'gemini-3.5-flash-lite';

export interface AiCause {
  cause: string;
  confidence: number;
  evidence: string;
}
export interface AiAction {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  action: string;
  target: string;
  rationale: string;
}
export interface AiBrief {
  headline: string;
  summary: string;
  likelyCauses: AiCause[];
  actions: AiAction[];
  watchlist: string[];
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

interface SituationInput {
  alerts: BlackBoxEvent[];
  nodes: SensorNode[];
}

const SYSTEM = `You are the environmental intelligence analyst embedded in EcoPulse, a real-time sensor network dashboard.
You receive active anomaly alerts and the surrounding sensor readings for the affected areas.
Your job: explain WHY the anomalies are likely happening and what operators should DO about them.
Ground every claim in the supplied telemetry. Be specific, concise and operational. Never invent sensors or events that were not provided.`;

function buildPrompt({ alerts, nodes }: SituationInput): string {
  const alertLines = alerts
    .map(
      (e) =>
        `- [${e.severity}] ${e.type} at ${e.nodeId} (Area ${e.areaId}) | measured ${e.measured} vs expected ${e.expected} (${e.deviation}) | duration ${e.duration} | confidence ${e.confidence}% | status ${e.status} | correlated sensors: ${e.sensors.join(', ')}`,
    )
    .join('\n');

  const nodeLines = nodes
    .map(
      (n) =>
        `- ${n.id} (Area ${n.areaId}, ${n.status}) temp ${n.reading.temperature.toFixed(1)}C, humidity ${n.reading.humidity.toFixed(0)}%, pressure ${n.reading.pressure.toFixed(1)}hPa, PM2.5 ${n.reading.pm25}ug/m3, AQI ${n.reading.aqi}, CO2 ${n.reading.co2}ppm, wind ${n.reading.windSpeed.toFixed(1)}m/s`,
    )
    .join('\n');

  return `ACTIVE ANOMALY ALERTS (${alerts.length}):
${alertLines || '(none)'}

AFFECTED / RELEVANT SENSOR READINGS (${nodes.length}):
${nodeLines || '(none)'}

Produce a situation brief that:
1. States the single most important thing an operator must know right now (headline + summary).
2. Gives the most plausible root causes, each with a confidence 0-100 and the specific telemetry evidence behind it.
3. Lists prioritised recommended actions (HIGH/MEDIUM/LOW), each naming the target node or area and the rationale.
4. Lists what to keep monitoring.`;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    likelyCauses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          cause: { type: 'STRING' },
          confidence: { type: 'INTEGER' },
          evidence: { type: 'STRING' },
        },
        required: ['cause', 'confidence', 'evidence'],
      },
    },
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          priority: { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          action: { type: 'STRING' },
          target: { type: 'STRING' },
          rationale: { type: 'STRING' },
        },
        required: ['priority', 'action', 'target', 'rationale'],
      },
    },
    watchlist: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['headline', 'summary', 'likelyCauses', 'actions', 'watchlist'],
} as const;

export async function analyzeSituation(input: SituationInput, signal?: AbortSignal): Promise<AiBrief> {
  if (!API_KEY || API_KEY === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
    throw new AiError('No Gemini API key configured. Add VITE_GEMINI_API_KEY to .env and restart the dev server.');
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
    },
  );

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      detail = err?.error?.message ?? detail;
    } catch {
      /* keep status text */
    }
    throw new AiError(`Gemini request failed: ${detail}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new AiError('Gemini returned an empty response.');

  try {
    return normalize(JSON.parse(text));
  } catch {
    throw new AiError('Could not parse the AI response.');
  }
}

function normalize(raw: any): AiBrief {
  const causes: AiCause[] = Array.isArray(raw?.likelyCauses)
    ? raw.likelyCauses.map((c: any) => ({
        cause: String(c?.cause ?? ''),
        confidence: Math.max(0, Math.min(100, Number(c?.confidence) || 0)),
        evidence: String(c?.evidence ?? ''),
      }))
    : [];
  const actions: AiAction[] = Array.isArray(raw?.actions)
    ? raw.actions.map((a: any) => ({
        priority: (['HIGH', 'MEDIUM', 'LOW'].includes(a?.priority) ? a.priority : 'MEDIUM') as AiAction['priority'],
        action: String(a?.action ?? ''),
        target: String(a?.target ?? ''),
        rationale: String(a?.rationale ?? ''),
      }))
    : [];
  return {
    headline: String(raw?.headline ?? 'AI situation brief'),
    summary: String(raw?.summary ?? ''),
    likelyCauses: causes,
    actions,
    watchlist: Array.isArray(raw?.watchlist) ? raw.watchlist.map((w: any) => String(w)) : [],
  };
}

export const AI_MODEL_LABEL = MODEL;
