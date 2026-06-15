// ===== Design chatbot (Hugging Face free inference) =====
import { HF_TOKEN, HF_MODEL } from './config.js';

// Returns the assistant's reply text. Falls back gracefully if the API is busy.
export async function askAssistant(userText, context) {
  const prompt = `<s>[INST] You are the Design Assistant for Diamond Plug LA, a fine-jewelry CAD studio. Speak warmly and like an expert jeweler. Keep replies under 4 sentences.

Context about this order: ${context}

When the customer requests a design change, end your reply with a line in EXACTLY this format:
REVISION: <precise jeweler instruction>
(translate vague wording into specifics, e.g. "thinner band" -> "reduce band width ~0.4mm"). Only add the REVISION line for actual design changes.

Customer: ${userText} [/INST]`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (HF_TOKEN) headers['Authorization'] = 'Bearer ' + HF_TOKEN;
    const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST', headers,
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 320, temperature: 0.7, return_full_text: false } })
    });
    if (!res.ok) throw new Error('HF ' + res.status);
    const data = await res.json();
    let text = '';
    if (Array.isArray(data) && data[0]?.generated_text) text = data[0].generated_text;
    else if (data.generated_text) text = data.generated_text;
    else throw new Error('no text');
    return text.replace(prompt, '').trim();
  } catch (e) {
    // Rule-based fallback so the flow never breaks
    return ruleBasedReply(userText, context);
  }
}

function ruleBasedReply(t, context) {
  const low = t.toLowerCase();
  if (/(price|cost|how much|estimate)/.test(low))
    return "I'll pull the estimate from your order details — your studio sets it from metal, stone and labor. You'll see the number on the design once it's priced.";
  if (/(when|how long|timeline|ready|time)/.test(low))
    return "Typical turnaround for a revision is 2-3 business days. You'll get a notification the moment a new version is ready.";
  if (/(thin|thinner|slim|narrow)/.test(low))
    return "Good call — a slimmer band reads more delicate.\nREVISION: Reduce band width by ~0.4mm and shank thickness proportionally.";
  if (/(thick|wider|bigger band|chunkier)/.test(low))
    return "We can give it more presence.\nREVISION: Increase band width by ~0.5mm for a bolder profile.";
  if (/(bigger stone|larger stone|bigger diamond|carat up)/.test(low))
    return "More sparkle, understood.\nREVISION: Increase center stone by ~0.25ct and resize setting/prongs to match.";
  if (/(smaller stone|smaller diamond)/.test(low))
    return "We can scale it down for balance.\nREVISION: Reduce center stone by ~0.25ct and tighten the setting.";
  if (/(halo|pave|accent|side stone)/.test(low))
    return "A halo adds brilliance around the center.\nREVISION: Add a single pavé halo (approx 0.01ct melee) around the center stone.";
  if (/(rose gold|white gold|yellow gold|platinum|silver)/.test(low)) {
    const metal = low.match(/rose gold|white gold|yellow gold|platinum|silver/)[0];
    return `Lovely choice — ${metal} will suit this piece.\nREVISION: Change metal to ${metal} and adjust finish accordingly.`;
  }
  return "Tell me what you'd like to change — the metal, the stone size, the band, or the overall style — and I'll send precise notes to your designer.";
}

// ===== SVG art (no external images) =====
export function diamondArt(hue = 'gold') {
  const c = hue === 'blue' ? '#7fd4e8' : '#c9a84c';
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g${hue}" cx="50%" cy="40%"><stop offset="0%" stop-color="${c}" stop-opacity="0.25"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>
    <rect width="200" height="200" fill="url(#g${hue})"/>
    <g fill="none" stroke="${c}" stroke-width="1" opacity="0.85">
      <path d="M100 40 L150 85 L100 165 L50 85 Z"/>
      <path d="M50 85 L150 85 M100 40 L78 85 L100 165 M100 40 L122 85 L100 165"/>
      <path d="M78 85 L100 40 L122 85" stroke-width="0.6" opacity="0.6"/>
    </g>
    <g stroke="${c}" stroke-width="0.5" opacity="0.3">
      <line x1="100" y1="10" x2="100" y2="32"/><line x1="170" y1="85" x2="190" y2="85"/><line x1="30" y1="85" x2="10" y2="85"/>
    </g>
  </svg>`;
}

export function ringArt() {
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="rg" cx="50%" cy="45%"><stop offset="0%" stop-color="#c9a84c" stop-opacity="0.2"/><stop offset="100%" stop-color="#c9a84c" stop-opacity="0"/></radialGradient></defs>
    <rect width="200" height="200" fill="url(#rg)"/>
    <ellipse cx="100" cy="120" rx="48" ry="50" fill="none" stroke="#c9a84c" stroke-width="3" opacity="0.85"/>
    <ellipse cx="100" cy="120" rx="40" ry="42" fill="none" stroke="#c9a84c" stroke-width="1" opacity="0.4"/>
    <path d="M100 30 L120 60 L100 92 L80 60 Z" fill="none" stroke="#7fd4e8" stroke-width="1.4"/>
    <path d="M80 60 L120 60 M100 30 L90 60 L100 92 M100 30 L110 60 L100 92" stroke="#7fd4e8" stroke-width="0.7" opacity="0.6" fill="none"/>
  </svg>`;
}
