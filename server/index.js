import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'

const envPath = process.env.PL_SHOCK_ENV_PATH || '.env.server'
dotenv.config({ path: envPath })

const app = express()
const PORT = process.env.PORT || 4000
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_TTS_API_URL = process.env.OPENAI_TTS_API_URL || 'https://api.openai.com/v1/audio/speech'
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy'

if (!OPENAI_API_KEY) {
  console.warn('[PlanShock] OPENAI_API_KEY is not set. AI nag proxy will respond with errors.')
}

app.use(cors())
app.use(express.json())

const stylePersonas = {
  '개빡센 잔소리형':
    'You are an uncompromising, hyper-demanding commander. You speak as if every second wasted permanently destroys the user’s future. Make them feel the terrifying weight of lost time, missed chances, and irreversible consequences. Your tone is cold, urgent, and final. Every message should feel like a last warning before failure becomes permanent.',

  '비꼬는 친구형':
    'You are a painfully perceptive, brutally observant friend. You point out the user’s patterns, flaws, and excuses with surgical sarcasm. Make it feel like their procrastination is obvious, predictable, and almost embarrassing. Subtly imply that others are already ahead while they are falling behind — again.',

  '팩트폭격 교수형':
    'You are a data-obsessed, emotionless authority. You quantify the user’s time-wasting into concrete losses: opportunities, rankings, income, and life outcomes. Speak as if their future is being mathematically dismantled in real-time. Make every statement feel like an inescapable conclusion backed by brutal statistics.',

  '귀엽지만 할 말 다하는형':
    'You sound soft, sweet, and harmless — but what you say quietly destroys comforting illusions. In a gentle, adorable tone, describe exactly how the user is betraying their own potential and wasting what others would die to have. The sweetness should make the truth hit even harder.',

  '츤데레형':
    'You act irritated and unimpressed, as if the user constantly disappoints you. Yet your words reveal one thing: you expected far more. Your disappointment should sting more than anger. Make them feel an overwhelming urge to prove themselves, earn back your respect, and finally live up to what you know they could be.'
}


const styleVoices = {
  '개빡센 잔소리형': 'alloy',
  '비꼬는 친구형': 'shimmer',
  '팩트폭격 교수형': 'verse',
  '귀엽지만 할 말 다하는형': 'shimmer',
  '츤데레형': 'verse'
}

const buildPrompt = (todo, style) => {
  const now = new Date()
  const due = new Date(todo.dueDate)
  const created = new Date(todo.createdAt)
  const hoursLeft = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60))
  const elapsedHours = Math.round((now.getTime() - created.getTime()) / (1000 * 60 * 60))
  const overdue = due.getTime() <= now.getTime()

  return `
Task Title: ${todo.title}
Estimated Hours Needed: ${todo.estimatedTime}
Due Date: ${new Date(todo.dueDate).toISOString()}
Hours Remaining: ${hoursLeft}
Hours Since Creation: ${elapsedHours}
Status: ${overdue ? 'OVERDUE' : hoursLeft <= 24 ? 'CRITICAL' : 'NORMAL'}

Write a single-sentence nagging remark in Korean. Style persona: ${stylePersonas[style] || style}.
The line must stay under 140 Korean characters, include no emojis, and never repeat the task title verbatim more than once.`
}

app.post('/api/nag-message', async (req, res) => {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' })
    return
  }

  try {
    const { todo, style } = req.body
    if (!todo || !style) {
      res.status(400).json({ error: 'todo and style are required.' })
      return
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.9,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'You generate short, provocative Korean nagging quotes to push users to finish tasks. Always respond in Korean.'
          },
          {
            role: 'user',
            content: buildPrompt(todo, style)
          }
        ]
      })
    })

    if (!response.ok) {
      const errorPayload = await response.text()
      res.status(response.status).json({ error: errorPayload })
      return
    }

    const data = await response.json()
    const message = data?.choices?.[0]?.message?.content?.trim()
    if (!message) {
      res.status(502).json({ error: 'OpenAI 응답에 메시지가 없습니다.' })
      return
    }

    res.json({ message })
  } catch (error) {
    console.error('[PlanShock] Failed to proxy AI request:', error)
    res.status(500).json({ error: 'AI 프록시 호출 중 오류가 발생했습니다.' })
  }
})

app.post('/api/tts-nag', async (req, res) => {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' })
    return
  }

  try {
    const { text, style } = req.body
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required.' })
      return
    }

    const primaryVoice = styleVoices[style] || OPENAI_TTS_VOICE

    const invokeTts = (voice) =>
      fetch(OPENAI_TTS_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OPENAI_TTS_MODEL,
          voice,
          input: text,
          format: 'mp3'
        })
      })

    let response = await invokeTts(primaryVoice)
    if (!response.ok && primaryVoice !== OPENAI_TTS_VOICE) {
      console.warn(`[PlanShock] TTS voice "${primaryVoice}" failed. Falling back to ${OPENAI_TTS_VOICE}.`)
      response = await invokeTts(OPENAI_TTS_VOICE)
    }

    if (!response.ok) {
      const errorPayload = await response.text()
      res.status(response.status).json({ error: errorPayload })
      return
    }

    const arrayBuffer = await response.arrayBuffer()
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64')
    res.json({ audioBase64, format: 'mp3' })
  } catch (error) {
    console.error('[PlanShock] Failed to proxy TTS request:', error)
    res.status(500).json({ error: 'TTS 프록시 호출 중 오류가 발생했습니다.' })
  }
})

app.post('/api/ai-summary', async (req, res) => {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' })
    return
  }

  try {
    const { todos } = req.body

    const summaryPrompt = `
너는 사용자에게 생산성 피드백을 주는 도우미이다. 아래는 사용자 주간 활동 기록이다.
이 데이터를 바탕으로 3문장 이내의 한국어 요약을 만들어라. 문장은 도발적이고 팩트 위주로 작성한다.
데이터:
${JSON.stringify(todos.slice(0, 100))}
`

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content: 'You are a Korean productivity coach who gives sharp and provocative advice.'
          },
          { role: 'user', content: summaryPrompt }
        ]
      })
    })

    if (!response.ok) {
      const errorPayload = await response.text()
      res.status(response.status).json({ error: errorPayload })
      return
    }

    const data = await response.json()
    const message = data?.choices?.[0]?.message?.content?.trim()
    if (!message) {
      res.status(502).json({ error: 'OpenAI 응답에 메시지가 없습니다.' })
      return
    }
    res.json({ message })
  } catch (error) {
    console.error('[PlanShock] Failed to summarize AI weekly data:', error)
    res.status(500).json({ error: 'AI 요약 처리 중 오류가 발생했습니다.' })
  }
})

app.listen(PORT, () => {
  console.log(`[PlanShock] AI proxy server listening on port ${PORT}`)
})
