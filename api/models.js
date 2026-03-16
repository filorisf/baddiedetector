module.exports = async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'No API key' });

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
  );
  const data = await r.json();
  const names = (data.models || []).map(m => m.name);
  return res.status(200).json({ models: names });
};
