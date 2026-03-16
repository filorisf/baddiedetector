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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Service unavailable' });

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
      const status = geminiRes.status;
      if (status === 429) return res.status(429).json({ error: 'Too many requests, please try again later' });
      return res.status(502).json({ error: 'Service unavailable, please try again later' });
    }

    const data = await geminiRes.json();
    const candidate = data.candidates?.[0];

    if (!candidate || candidate.finishReason === 'SAFETY') {
      return res.status(422).json({ error: 'Could not analyze this image. Try a different photo.' });
    }

    const text = candidate.content?.parts?.[0]?.text || '';
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      return res.status(502).json({ error: 'Please try again.' });
    }

    let result;
    try {
      result = JSON.parse(text.slice(start, end + 1));
    } catch {
      return res.status(502).json({ error: 'Please try again.' });
    }

    const score = Math.round(Math.min(Math.max(Number(result.score) || 0, 0), 100));

    return res.status(200).json({
      score,
      label:       String(result.label       || '').slice(0, 60),
      description: String(result.description || '').slice(0, 400),
      highlights:  (Array.isArray(result.highlights) ? result.highlights : []).slice(0, 5).map(String),
    });

  } catch {
    return res.status(500).json({ error: 'Please try again.' });
  }
};
