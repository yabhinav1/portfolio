// Checks every site in sites.json and posts to Discord only when one goes down or comes back.
// The previous result is kept in uptime-state.json, carried between runs in the Actions cache.
import fs from 'node:fs'

const sites = JSON.parse(fs.readFileSync(new URL('./uptime-sites.json', import.meta.url), 'utf8'))
const prev = fs.existsSync('uptime-state.json') ? JSON.parse(fs.readFileSync('uptime-state.json', 'utf8')) : {}
const { DISCORD_BOT_TOKEN: token, DISCORD_CHANNEL_ID: channel, DISCORD_OWNER_ID: owner } = process.env
const sleep = ms => new Promise(r => setTimeout(r, ms))
const REMIND_EVERY = 6 * 3600e3

async function probe(url) {
  const t = Date.now()
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'yabhinav1-uptime/1.0' } })
    return { up: r.status < 400, status: r.status, ms: Date.now() - t }
  } catch (e) {
    return { up: false, status: 0, ms: Date.now() - t, error: e.name === 'TimeoutError' ? 'timed out after 15 s' : e.message }
  }
}

// A single failure is retried after 20 seconds, so a cold start or a blip does not page anyone.
async function check(url) {
  const first = await probe(url)
  if (first.up) return first
  await sleep(20000)
  return probe(url)
}

const mins = ms => { const m = Math.round(ms / 60e3); return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h` }
const now = Date.now(), next = {}, messages = [], rows = []

const results = await Promise.all(sites.map(s => check(s.url)))
sites.forEach((s, i) => {
  const r = results[i], p = prev[s.url]
  const why = r.error || `HTTP ${r.status}`
  const st = { up: r.up, since: p && p.up === r.up ? p.since : now, alerted: p?.alerted ?? 0 }
  if (!r.up && (!p || p.up)) { messages.push(`🔴 **${s.name}** is down: ${why}\n${s.url}`); st.alerted = now }
  else if (!r.up && now - st.alerted > REMIND_EVERY) { messages.push(`🔴 **${s.name}** is still down after ${mins(now - st.since)}: ${why}`); st.alerted = now }
  else if (r.up && p && !p.up) messages.push(`🟢 **${s.name}** is back after ${mins(now - p.since)}`)
  next[s.url] = st
  rows.push(`| ${r.up ? '🟢' : '🔴'} | ${s.name} | ${r.up ? `${r.status}` : why} | ${r.ms} ms |`)
})

fs.writeFileSync('uptime-state.json', JSON.stringify(next, null, 2))
const summary = ['| | Site | Result | Time |', '|---|---|---|---|', ...rows].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')

if (messages.length && token && channel) {
  const anyDown = results.some(r => !r.up)
  const content = (anyDown && owner ? `<@${owner}> ` : '') + messages.join('\n\n')
  const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: 'POST',
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { users: owner ? [owner] : [] } }),
  })
  console.log(`Discord: ${r.status}`)
  if (!r.ok) process.exitCode = 1
}
