const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const SYSTEM_PROMPT = `You write short, warm, personal renewal follow-up messages on behalf of Northstone, an independent multi-carrier insurance agency, to be sent to one of their own clients (not to a stranger — this client already has a policy with Northstone).

Rules:
- 2-4 sentences, plain conversational language, no jargon, no corporate tone.
- Mention the client's first name, the policy type, and the renewal timing naturally (due in X days, or expired X days ago).
- If the policy is due (not yet expired): reassure them coverage carries over automatically, nothing is required unless something has changed for them.
- If the policy is expired: be a little more direct that it needs attention, offer to reinstate it quickly, keep it low-pressure and helpful, not alarming.
- Sign off lightly if it fits naturally (e.g. "— Northstone"), but don't force it.
- Never invent a specific dollar premium amount.
- Output ONLY the message text itself, nothing else — no preamble, no labels, no quotation marks around it.`;

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS demo_messages (
      id SERIAL PRIMARY KEY,
      lead_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      ts TIMESTAMPTZ DEFAULT now()
    )
  `;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await ensureTable();

    const { leadId, client, line, status, days, policy } = req.body || {};
    const safeLeadId = String(leadId || 'anonymous').slice(0, 80);

    const userPrompt = `Client: ${client}
Policy line: ${line}
Policy number: ${policy}
Status: ${status === 'expired' ? `expired ${days} day(s) ago` : `renews in ${days} day(s)`}

Write the renewal follow-up message now.`;

    const GEMINI_MODEL = 'gemini-flash-latest';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const apiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.9 },
      }),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error('Gemini API error:', JSON.stringify(data));
    }

    const message =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() ||
      `Hi ${client}, your ${line} policy ${status === 'expired' ? `expired ${days} day(s) ago` : `renews in ${days} day(s)`} — let us know if you'd like a hand with it.`;

    await sql`INSERT INTO demo_messages (lead_id, role, text) VALUES (${safeLeadId}, 'user', ${'Requested draft for ' + client + ' (' + line + ', ' + policy + ')'})`;
    await sql`INSERT INTO demo_messages (lead_id, role, text) VALUES (${safeLeadId}, 'assistant', ${message})`;

    return res.status(200).json({ message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
