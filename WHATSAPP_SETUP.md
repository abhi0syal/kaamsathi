# WhatsApp Sandbox Setup Checklist (KaamSathi)

Work top to bottom and tick each box. Option A (Meta) is the main route. Option B (Twilio) is the fallback.

Meta and Twilio change their dashboards often. If a menu name differs, check their current "Get Started" docs.

---

## 0. Before you start

- [ ] Your app is deployed on Vercel and you have a public HTTPS URL: `https://<your-app>.vercel.app`
- [ ] `/api/whatsapp/webhook` exists in the code (Prompt 1)
- [ ] You chose a random string for `WHATSAPP_VERIFY_TOKEN` (for example, 20+ random characters)
- [ ] You have a Facebook account, plus 1-5 phones with WhatsApp for testing

Local development alternative: run `ngrok http 3000` (or `cloudflared tunnel --url http://localhost:3000`) and use the HTTPS URL it prints instead of the Vercel URL.

---

## Option A: Meta WhatsApp Cloud API (free test number)

### A1. Create the app
- [ ] Go to developers.facebook.com and log in
- [ ] My Apps -> Create App -> choose the **Business** type
- [ ] Add the **WhatsApp** product to the app

### A2. Collect credentials
- [ ] WhatsApp -> API Setup: copy the **Phone number ID** -> `WHATSAPP_PHONE_NUMBER_ID`
- [ ] Copy the **temporary access token** -> `WHATSAPP_TOKEN` (expires in about 24 hours)
- [ ] App Settings -> Basic: copy the **App Secret** -> `WHATSAPP_APP_SECRET`
- [ ] Put all values in Vercel (Project -> Settings -> Environment Variables) and in a local `.env.local`
- [ ] Redeploy after changing env vars

### A3. Add test recipients
- [ ] API Setup -> "To" field -> manage phone number list
- [ ] Add your own number and your teammates' numbers (small cap, about 5)
- [ ] Enter the verification code each person receives on WhatsApp
- [ ] Only these numbers can talk to the test number

### A4. Smoke test sending
- [ ] Click "Send message" with the `hello_world` template
- [ ] Confirm it arrives on your phone

### A5. Connect the webhook
- [ ] WhatsApp -> Configuration -> Webhook -> Edit
- [ ] Callback URL: `https://<your-app>.vercel.app/api/whatsapp/webhook`
- [ ] Verify token: the same string as `WHATSAPP_VERIFY_TOKEN`
- [ ] Click Verify and Save (this calls your GET handler)
- [ ] Under Webhook fields, **subscribe to `messages`**

### A6. Test the bot
- [ ] From a registered phone, message the test number: `hi`
- [ ] You should get the language buttons, then the consent message, then the menu
- [ ] Send a voice note and confirm it is transcribed
- [ ] Send a photo and a location pin
- [ ] Type `DELETE MY DATA` and confirm the wipe works

### A7. Make the token last (do this before demo day)
- [ ] business.facebook.com -> Business Settings -> Users -> **System Users** -> Add
- [ ] Assign the app with full control, then Generate token
- [ ] Select permissions `whatsapp_business_messaging` and `whatsapp_business_management`
- [ ] Replace `WHATSAPP_TOKEN` in Vercel and redeploy

### A8. Template for proactive messages (weekly summary)
- [ ] WhatsApp -> Message Templates -> Create (category: Utility)
- [ ] Submit early, since approval can take time
- [ ] Until approved, use the app's mock mode for the demo
- [ ] Only message users who opted in

---

## Option B: Twilio WhatsApp Sandbox (fallback)

### B1. Account and sandbox
- [ ] Create a free Twilio account
- [ ] Messaging -> Try it out -> Send a WhatsApp message
- [ ] Note the sandbox number and your **join code** (`join <two-words>`)

### B2. Join from each test phone
- [ ] Send `join <your-code>` to the sandbox number on WhatsApp
- [ ] Sessions expire after a few days, so rejoin when messages stop

### B3. Webhook
- [ ] Sandbox settings -> "When a message comes in": `https://<your-app>.vercel.app/api/twilio/webhook` (POST)
- [ ] Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` to env vars
- [ ] Set `CHANNEL_PROVIDER=twilio` and redeploy

### B4. Known differences
- Interactive reply buttons and lists are limited in the sandbox, so the bot falls back to **numbered menus** ("Reply 1, 2 or 3")
- Inbound media comes as a URL; downloading it may need your Twilio credentials
- Webhook signature header is `X-Twilio-Signature`, not Meta's header

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhook verification fails | Verify token mismatch, or the app is not deployed | Check the env var, redeploy, open the webhook URL in a browser |
| No messages arrive after verifying | `messages` field not subscribed | Subscribe in Webhook fields |
| Bot replies twice | Missing dedupe by message ID | Check the Redis dedupe key |
| Signature check rejects everything | Wrong App Secret, or body parsed before verification | Verify the signature against the raw request body |
| Replies stop after a day | Temporary token expired | Use a System User token |
| Reply not delivered | More than 24 hours since the user's last message | Use an approved template |
| Voice note not transcribed | Media download failed | Check token and media ID handling |
| Judge cannot message the bot | Number is not a registered recipient | Add them, or share the `/simulator` link and a screen recording |

---

## Demo-day checklist

- [ ] System User token is set (not the temporary one)
- [ ] Demo phones are registered recipients
- [ ] Each demo phone has sent `hi` within the last 24 hours
- [ ] Redis is reachable and Vercel logs show 200 responses
- [ ] Web simulator link works as a backup
- [ ] Screen recording of the real WhatsApp flow is saved offline
