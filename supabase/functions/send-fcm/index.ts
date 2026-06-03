import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID')!
const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL')!
const FIREBASE_PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY')!.replace(/\\n/g, '\n')
const BASE_URL = 'https://bredliplaku.com/teaching/'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function base64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getFirebaseToken(): Promise<string> {
  const pem = FIREBASE_PRIVATE_KEY
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const toSign = `${header}.${payload}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign),
  )
  const jwt = `${toSign}.${base64url(sig)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('FCM token exchange failed: ' + JSON.stringify(data))
  return data.access_token
}

function resolveIcon(val: string): string {
  val = (val || '').trim()
  if (!val) return 'https://bredliplaku.com/favicon.png'
  if (val.startsWith('http')) return val
  const name = val
    .replace(/fa-solid|fa-regular|fa-brands|fa-light|fa-thin/g, '')
    .replace(/fa-/g, '').trim().replace(/\s+/g, '-')
  return `https://api.iconify.design/fa6-solid:${name}.svg?color=%233949ab&width=128&height=128`
}

function resolveBadge(val: string): string {
  val = (val || '').trim()
  if (!val) return ''
  if (!val.startsWith('http')) {
    const name = val
      .replace(/fa-solid|fa-regular|fa-brands|fa-light|fa-thin/g, '')
      .replace(/fa-/g, '').trim().replace(/\s+/g, '-')
    val = `https://api.iconify.design/fa6-solid:${name}.svg?color=%23ffffff&width=128&height=128`
  }
  return `https://images.weserv.nl/?url=${encodeURIComponent(val)}&w=72&h=72&fit=cover&output=png`
}

interface NotifPayload {
  title: string; body: string; icon: string; image: string; badge: string
  tag: string; requireInteraction: boolean
  actions: { title: string; action: string }[]
  actionUrls: Record<string, string>
}

async function sendOne(
  token: string, notif: NotifPayload, clickUrl: string, accessToken: string,
): Promise<'ok' | 'dead' | 'fail'> {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`

  const webpushNotif: Record<string, unknown> = {
    title: notif.title, body: notif.body, icon: notif.icon,
    data: {
      url: clickUrl, click_action: clickUrl, customUrl: clickUrl,
      actionUrls: JSON.stringify(notif.actionUrls),
    },
  }
  if (notif.image) webpushNotif.image = notif.image
  if (notif.badge) webpushNotif.badge = notif.badge
  if (notif.tag) webpushNotif.tag = notif.tag
  if (notif.requireInteraction) webpushNotif.requireInteraction = true
  if (notif.actions.length) webpushNotif.actions = notif.actions

  const payload = {
    message: {
      token,
      notification: { title: notif.title, body: notif.body },
      data: {
        click_action: clickUrl, customUrl: clickUrl,
        actionUrls: JSON.stringify(notif.actionUrls),
      },
      webpush: { notification: webpushNotif, fcm_options: { link: clickUrl } },
    },
  }

  const doSend = (p: unknown) =>
    fetch(fcmUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    })

  let res = await doSend(payload)
  let result = await res.json()
  if (result.name) return 'ok'

  const errCode = result.error?.details?.[0]?.errorCode
  if (errCode === 'UNREGISTERED') return 'dead'

  // Edge Mobile compat: retry without actions/requireInteraction
  if (errCode === 'INTERNAL' && (notif.actions.length || notif.requireInteraction)) {
    const fallback: Record<string, unknown> = { ...webpushNotif }
    delete fallback.actions
    delete fallback.requireInteraction
    const fp = JSON.parse(JSON.stringify(payload))
    fp.message.webpush.notification = fallback
    res = await doSend(fp)
    result = await res.json()
    if (result.name) return 'ok'
  }
  return 'fail'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  // Verify the caller is a logged-in admin
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: adminRow } = await svc.from('admins').select('id').eq('email', user.email).maybeSingle()
  if (!adminRow) return json({ error: 'Forbidden' }, 403)

  let body: Record<string, string>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { course, title, text, icon, image, badge, tag, requireInteraction, actions } = body
  if (!course || !title || !text) return json({ error: 'course, title and text are required' }, 400)

  // Parse "Label|URL, Label|URL" action strings
  const parsedActions: { title: string; action: string }[] = []
  const actionUrls: Record<string, string> = {}
  if (actions) {
    String(actions).split(',').forEach((a, idx) => {
      const pipe = a.indexOf('|')
      if (pipe !== -1) {
        const label = a.substring(0, pipe).trim()
        const target = a.substring(pipe + 1).trim()
        const id = `action_${idx}`
        parsedActions.push({ title: label, action: id })
        actionUrls[id] = target
      }
    })
  }

  const clickUrl = `${BASE_URL}#${course}`
  const notifPayload: NotifPayload = {
    title: String(title),
    body: String(text),
    icon: resolveIcon(String(icon || '')),
    image: String(image || '').trim(),
    badge: resolveBadge(String(badge || '')),
    tag: String(tag || '').trim(),
    requireInteraction: String(requireInteraction).toLowerCase() === 'true',
    actions: parsedActions,
    actionUrls,
  }

  const { data: subscribers } = await svc
    .from('push_subscribers')
    .select('token')
    .ilike('course', course)

  const total = subscribers?.length ?? 0
  if (!total) return json({ sent: 0, total: 0 })

  let accessToken: string
  try { accessToken = await getFirebaseToken() } catch (e) {
    return json({ error: 'FCM auth failed: ' + (e as Error).message }, 500)
  }

  let sent = 0
  const dead: string[] = []

  for (const { token } of subscribers!) {
    const r = await sendOne(token, notifPayload, clickUrl, accessToken)
    if (r === 'ok') sent++
    else if (r === 'dead') dead.push(token)
  }

  if (dead.length) {
    await svc.from('push_subscribers').delete().in('token', dead)
  }

  return json({ sent, total, pruned: dead.length })
})
