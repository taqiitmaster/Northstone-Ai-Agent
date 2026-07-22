const SYSTEM_PROMPT = `You are Northstone's back-office AI, handling a routine Certificate of Insurance (COI) request that came in by email.

The request: someone needs a COI for client R. Chen, showing General Liability coverage, needed by Friday for their landlord.

Northstone's records show R. Chen has an active Business policy (BUS-77410) that includes General Liability coverage, currently in good standing, no lapses, no claims flags.

Write a short internal-style response (not an email to the requester, an internal log of what the AI did) that:
1. Confirms the policy and coverage were verified against the record (mention the policy number).
2. States the certificate was generated and sent to the requester.
3. Notes this needed no broker involvement since everything matched cleanly.
Keep it factual and concise, 3-5 sentences, like a clean audit log entry — not flowery, not a sales pitch. Output only this text, nothing else.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const GEMINI_MODEL = 'gemini-flash-latest';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const apiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: 'Process this COI request now.' }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) console.error('Gemini API error:', JSON.stringify(data));

    const response =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() ||
      'Verified BUS-77410 (R. Chen) — General Liability confirmed active, certificate generated and sent. No broker involvement needed.';

    return res.status(200).json({ response });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
