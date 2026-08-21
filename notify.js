// Outbound notifications for contact-form messages.
// Both are plain fetch calls, so no new runtime dependencies.
// Each one is a no-op when its env var is missing, so the site never breaks
// just because a key is unset — a message is still saved to the database.

const RESEND = process.env.RESEND_API_KEY
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL
const FROM = process.env.MAIL_FROM || 'Portfolio <onboarding@resend.dev>'
const TO = process.env.CONTACT_TO || ''

const cut = (s, n) => String(s ?? '').slice(0, n)

/** Send mail through Resend. Returns null when unconfigured. */
export async function sendMail ({ to, subject, text, replyTo }) {
  if (!RESEND || !to) return null
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [to], subject, text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })
  if (!r.ok) throw new Error(`resend ${r.status}: ${cut(await r.text(), 200)}`)
  return r.json()
}

/** Post to a Discord webhook. Returns null when unconfigured. */
export async function pingDiscord (msg) {
  if (!WEBHOOK) return null
  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'Portfolio',
      embeds: [{
        title: 'New message from the contact form',
        color: 0xb0451f,
        fields: [
          { name: 'From', value: cut(msg.name || 'Anonymous', 256) },
          { name: 'Email', value: cut(msg.email, 256) },
          { name: 'Message', value: cut(msg.body, 1000) || '(empty)' },
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  })
  if (!r.ok) throw new Error(`discord ${r.status}`)
  return true
}

/** Fire both, never throw: a failed notification must not fail the request. */
export async function notifyNew (msg) {
  const results = await Promise.allSettled([
    pingDiscord(msg),
    sendMail({
      to: TO,
      replyTo: msg.email,                       // hitting Reply goes to the sender
      subject: `Portfolio: ${msg.name || 'message'} <${msg.email}>`,
      text: `${msg.name || 'Anonymous'} <${msg.email}>\n\n${msg.body}\n\n— sent from your contact form`,
    }),
  ])
  for (const r of results) if (r.status === 'rejected') console.error('notify:', r.reason?.message || r.reason)
}
