const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

module.exports = async (req, res) => {
  const { key } = req.query;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).send('Unauthorized — add ?key=YOUR_ADMIN_KEY to the URL');
  }

  try {
    const leadRows = await sql`
      SELECT lead_id, MIN(ts) AS first_seen, MAX(ts) AS last_seen, COUNT(*) AS message_count
      FROM demo_messages
      GROUP BY lead_id
      ORDER BY last_seen DESC
    `;

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Inphint — Demo Leads</title>
      <style>
        body{font-family:Arial,sans-serif;background:#F6F1E7;color:#1B2B22;padding:32px;max-width:820px;margin:0 auto;}
        h1{font-size:22px;}
        .lead{background:#fff;border:1px solid #e2ddd0;border-radius:14px;padding:18px 20px;margin-bottom:16px;}
        .lead h3{margin:0 0 4px;font-size:16px;}
        .meta{font-size:12px;color:#666;margin-bottom:12px;}
        .msg{font-size:13px;margin-bottom:6px;line-height:1.4;}
        .msg b{color:#4C6355;}
        .empty{color:#888;font-size:14px;}
      </style></head><body>
      <h1>🔎 Who's tried the Northstone demo</h1>
      <p class="meta">${leadRows.length} lead(s) so far. Refresh anytime.</p>`;

    if (leadRows.length === 0) html += `<p class="empty">No conversations yet.</p>`;

    for (const lead of leadRows) {
      const msgs = await sql`
        SELECT role, text, ts FROM demo_messages
        WHERE lead_id = ${lead.lead_id}
        ORDER BY ts ASC
      `;
      html += `<div class="lead"><h3>${lead.lead_id}</h3>
        <div class="meta">First seen: ${new Date(lead.first_seen).toLocaleString()} · Last active: ${new Date(lead.last_seen).toLocaleString()} · ${lead.message_count} messages</div>`;
      for (const m of msgs) {
        html += `<div class="msg"><b>${m.role === 'user' ? 'Them' : 'Agent'}:</b> ${(m.text || '').replace(/</g, '&lt;')}</div>`;
      }
      html += `</div>`;
    }
    html += `</body></html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error loading leads');
  }
};
