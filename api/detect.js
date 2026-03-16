const GEMINI_MODEL = 'gemini-2.5-flash';

const PROMPT = `You are the Baddie Detector — an AI that scores how much someone embodies the "baddie" aesthetic popular on Instagram and TikTok.

A "baddie" radiates confidence and has a strong personal style: bold or flawless makeup, trendy outfits, styled hair, powerful poses, and a high-fashion social media vibe.

Score the person in this photo from 0 to 100:
  0–20  → "Not Giving Baddie"
  21–40 → "Baddie in Training"
  41–60 → "Baddie Potential Unlocked"
  61–80 → "Certified Baddie"
  81–100 → "Ultimate Baddie"

Evaluate these factors:
- Makeup / beauty styling
- Outfit and fashion sense
- Hair styling and grooming
- Confidence, pose, and overall energy
- Aesthetic composition of the photo

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "score": <integer 0-100>,
  "label": "<short catchy label matching the tier above>",
  "description": "<2-3 sentences of honest, fun commentary on their baddie level>",
  "highlights": ["<standout trait 1>", "<standout trait 2>", "<standout trait 3>"]
}`;

module.exports = async function handler(req, res) {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mimeType } = req.body || {};

  if (!image) return res.status(400).json({ error: 'No image provided' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } },
        { text: PROMPT },
      ],
    }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!geminiRes.ok) {
      const text = await geminiRes.text();
      console.error('Gemini error status:', geminiRes.status, text);
      let detail = '';
      try { detail = JSON.parse(text)?.error?.message || text; } catch { detail = text; }
      return res.status(502).json({ error: `Gemini error (${geminiRes.status}): ${detail}` });
    }

    const data = await geminiRes.json();

    const candidate = data.candidates?.[0];
    if (!candidate) {
      return res.status(422).json({ error: 'Could not analyze this image. Try a clearer photo.' });
    }

    // Check for safety block
    if (candidate.finishReason === 'SAFETY') {
      return res.status(422).json({ error: 'Image flagged by safety filters. Try a different photo.' });
    }

    const text = candidate.content?.parts?.[0]?.text || '';

    // DEBUG — always return raw info so we can diagnose
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      console.error('No JSON found:', text);
      return res.status(502).json({ error: 'Unexpected AI response. Please try again.' });
    }

    const jsonStr = text.slice(start, end + 1);
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (e) {
      console.error('JSON parse error:', e.message, jsonStr.slice(0, 200));
      return res.status(502).json({ error: 'Could not parse AI response. Please try again.' });
    }

    // Validate & sanitize
    const score = Math.round(Math.min(Math.max(Number(result.score) || 0, 0), 100));

    return res.status(200).json({
      score,
      label:       String(result.label       || '').slice(0, 60),
      description: String(result.description || '').slice(0, 400),
      highlights:  (Array.isArray(result.highlights) ? result.highlights : []).slice(0, 5).map(String),
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
