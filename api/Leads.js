const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const DRAFT_SYSTEM_PROMPT = `You write short, warm, personal renewal follow-up messages on behalf of Northstone, an independent multi-carrier insurance agency, to one of their own existing clients.

Rules:
- 2-4 sentences, plain conversational language, no jargon, no corporate tone.
- Mention the client's first name, the policy type, and the renewal timing naturally.
- This may be the 1st, 2nd, 3rd (etc) follow-up to this same client about the same renewal — if it's not the first, acknowledge lightly that this is a nudge (e.g. "just circling back", "still here whenever you're ready") without being pushy or repeating the exact same wording as a first message would use.
- Never invent a specific dollar premium amount.
- Output ONLY the message text itself, nothing else — no preamble, no labels, no quotation marks.`;

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS demo_leads_added (
      id SERIAL PRIMARY KEY,
      owner_lead_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      line TEXT NOT NULL,
      days INT NOT NULL DEFAULT 7,
      followup_count INT NOT NULL DEFAULT 3,
      followups_sent INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS demo_leads_messages (
      id SERIAL PRIMARY KEY,
      lead_record_id INT NOT NULL REFERENCES demo_leads_added(id) ON DELETE CASCADE,
      sequence_no INT NOT NULL,
      text TEXT NOT NULL,
      sent BOOLEAN NOT NULL DEFAULT false,
      sent_note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;
}

async function generateMessage(name, line, days, sequenceNo) {
  const userPrompt = `Client: ${name}\nPolicy line: ${line}\nRenews in: ${days} day(s)\nThis is follow-up #${sequenceNo} for this renewal.\n\nWrite the message now.`;
  const GEMINI_MODEL = 'gemini-flash-latest';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const apiRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: DRAFT_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.9 },
    }),
  });
  const data = await apiRes.json();
  if (!apiRes.ok) console.error('Gemini API error:', JSON.stringify(data));
  return (
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() ||
    `Hi ${name}, following up on your ${line} policy renewing in ${days} day(s) — let us know if you'd like a hand with it.`
  );
}

// Sends a real email via Resend's free tier if RESEND_API_KEY is set.
// If not configured, this quietly no-ops so the demo still works without it.
async function tryRealSend(toEmail, subject, text) {
  if (!process.env.RESEND_API_KEY || !toEmail) {
    return { sent: false, note: 'Demo mode — no real email sent (add RESEND_API_KEY to enable this).' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Northstone Demo <onboarding@resend.dev>',
        to: [toEmail],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error:', errText);
      return { sent: false, note: 'Real send failed — showing as draft only.' };
    }
    return { sent: true, note: `Real email sent to ${toEmail}` };
  } catch (err) {
    console.error('Resend exception:', err);
    return { sent: false, note: 'Real send failed — showing as draft only.' };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();

    // ---------- LIST ----------
    if (req.method === 'GET' && req.query.action === 'list') {
      const ownerLeadId = String(req.query.ownerLeadId || '');
      const rows = await sql`
        SELECT * FROM demo_leads_added WHERE owner_lead_id = ${ownerLeadId} ORDER BY created_at DESC
      `;
      return res.status(200).json({ leads: rows });
    }

    // ---------- THREAD ----------
    if (req.method === 'GET' && req.query.action === 'thread') {
      const leadRecordId = parseInt(req.query.leadRecordId, 10);
      const leadRows = await sql`SELECT * FROM demo_leads_added WHERE id = ${leadRecordId}`;
      const messages = await sql`
        SELECT * FROM demo_leads_messages WHERE lead_record_id = ${leadRecordId} ORDER BY sequence_no ASC
      `;
      return res.status(200).json({ lead: leadRows[0] || null, messages });
    }

    // ---------- CREATE ----------
    if (req.method === 'POST' && req.body?.action === 'create') {
      const { ownerLeadId, name, email, line, days, followupCount, sendReal } = req.body;
      const safeOwner = String(ownerLeadId || 'anonymous').slice(0, 80);
      const safeName = String(name || 'Client').slice(0, 120);
      const safeLine = String(line || 'Auto').slice(0, 40);
      const safeDays = Math.max(0, parseInt(days, 10) || 7);
      const safeCount = Math.min(5, Math.max(1, parseInt(followupCount, 10) || 3));

      const inserted = await sql`
        INSERT INTO demo_leads_added (owner_lead_id, name, email, line, days, followup_count, followups_sent)
        VALUES (${safeOwner}, ${safeName}, ${email || null}, ${safeLine}, ${safeDays}, ${safeCount}, 0)
        RETURNING *
      `;
      const lead = inserted[0];

      const message = await generateMessage(safeName, safeLine, safeDays, 1);
      let sendResult = { sent: false, note: null };
      if (sendReal && email) {
        sendResult = await tryRealSend(email, `Your ${safeLine} policy renewal`, message);
      }

      await sql`
        INSERT INTO demo_leads_messages (lead_record_id, sequence_no, text, sent, sent_note)
        VALUES (${lead.id}, 1, ${message}, ${sendResult.sent}, ${sendResult.note})
      `;
      await sql`UPDATE demo_leads_added SET followups_sent = 1 WHERE id = ${lead.id}`;

      return res.status(200).json({ ok: true, leadId: lead.id });
    }

    // ---------- NEXT FOLLOW-UP ----------
    if (req.method === 'POST' && req.body?.action === 'followup') {
      const leadRecordId = parseInt(req.body.leadRecordId, 10);
      const leadRows = await sql`SELECT * FROM demo_leads_added WHERE id = ${leadRecordId}`;
      const lead = leadRows[0];
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      if (lead.followups_sent >= lead.followup_count) {
        return res.status(200).json({ ok: true, note: 'All follow-ups already sent' });
      }

      const nextSeq = lead.followups_sent + 1;
      const message = await generateMessage(lead.name, lead.line, lead.days, nextSeq);
      let sendResult = { sent: false, note: null };
      if (lead.email) {
        sendResult = await tryRealSend(lead.email, `Following up — your ${lead.line} policy renewal`, message);
      }

      await sql`
        INSERT INTO demo_leads_messages (lead_record_id, sequence_no, text, sent, sent_note)
        VALUES (${leadRecordId}, ${nextSeq}, ${message}, ${sendResult.sent}, ${sendResult.note})
      `;
      await sql`UPDATE demo_leads_added SET followups_sent = ${nextSeq} WHERE id = ${leadRecordId}`;

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
