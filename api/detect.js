const GEMINI_MODEL = 'gemini-2.5-flash';

// Simple in-memory rate limiter: max 5 requests per IP per minute
const ipMap = new Map();
const WINDOW_MS  = 60 * 1000;
const MAX_PER_IP = 5;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    ipMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= MAX_PER_IP) return true;
  entry.count++;
  ipMap.set(ip, entry);
  return false;
}

const PROMPT = `You are the Baddie Detector. No filter, no kindness bias, no sugarcoating. Your job is to score how much someone is a "baddie" in the Instagram/TikTok sense.

A baddie: flawless or bold makeup, fire outfit, styled hair, confident energy, magnetic presence. Think Kylie Jenner, Doja Cat, Sza, Rihanna — girls who look effortlessly untouchable.
NOT a baddie: casual hoodies, no makeup, flat hair, nerdy vibes, awkward poses, zero styling effort.

## STEP 1 — VIBE CHECK (do this first, internally)
Look at the photo as a whole. Your gut reaction in the first second. Ask yourself:
- Would this person fit on a baddie Instagram page? Yes / Maybe / No
- Does the overall image scream style, confidence, and intentionality?
- What is the immediate impression — baddie, regular girl, or anti-baddie?

Commit to a vibe tier based on that first impression:
- Instant baddie → final score will be 75–100
- Mostly baddie → 55–74
- Mixed vibes → 35–54
- Barely → 15–34
- Not at all → 0–14

## STEP 2 — DETAIL ANALYSIS (refine the score within the tier)
Now scan every detail to find the exact score within your vibe tier:
- Makeup: brows, lashes, skin, lips — done or not?
- Outfit: is it fire, stylish, trendy — or casual, sloppy, boring?
- Hair: styled, voluminous, colored, sleek — or flat, unstyled, ignored?
- Pose & energy: owns the camera or looks uncomfortable?
- Accessories & extras: nails, jewelry, shoes, bag — do they add to the look?
- Context: background, lighting, photo quality — does it elevate or kill the vibe?

Use the details to land on a precise number within the tier you committed to in Step 1.

## STRICT RULES:
- Your gut vibe from Step 1 is your anchor. Commit to it. Do not sit in the middle to be safe.
- There are only 3 real outcomes — land clearly in one of them:
  → Clearly NOT a baddie: score 20–45. No effort, casual, nerdy, basic, unstylish.
  → Baddie potential, some elements there but not the full package: score 55–65.
  → Clearly a baddie: score 75–95. The vibe is undeniable, styling is intentional, presence is there.
- Do NOT cluster around 50 or 65 when the answer is obvious. Be decisive.
- Pretty face with zero styling = 20–35. Looks alone don't make a baddie.
- Full beat, fire outfit, confident energy = 75+. Don't hold back when it's earned.
- Glasses: trendy frames on a styled look = fine. Nerdy frames + no effort = not baddie.
- Do NOT round to multiples of 5. Exact numbers only: 23, 67, 41, 88, 31, 78.

Tiers (for label only):
  0–20  → "Not Giving Baddie"
  21–40 → "Baddie in Training"
  41–60 → "Baddie Potential Unlocked"
  61–80 → "Certified Baddie"
  81–100 → "Ultimate Baddie"

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "score": <exact integer 0-100>,
  "label": "<short catchy label matching the tier>",
  "description": "<2-3 sentences — write like a witty, sharp best friend who tells the truth but makes it fun. Use humor and punchlines when the score is low (roast the look without being mean). Give genuine hype when the score is high. Always say something real and specific about what's in the photo. Never be generic.>",
  "highlights": ["<2-4 word tag>", "<2-4 word tag>", "<2-4 word tag>"]
}`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }

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
      temperature: 1.0,
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
