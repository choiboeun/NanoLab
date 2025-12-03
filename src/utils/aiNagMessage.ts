import type { TodoItem, NagStyle } from './nagMessages'

const DEFAULT_PROXY_URL = '/api/nag-message'

export async function fetchAiNagMessage(todo: TodoItem, style: NagStyle, signal?: AbortSignal): Promise<string> {
  const proxyUrl = import.meta.env.VITE_AI_PROXY_URL || DEFAULT_PROXY_URL

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      todo: {
        title: todo.title,
        dueDate: todo.dueDate.toISOString(),
        estimatedTime: todo.estimatedTime,
        createdAt: todo.createdAt.toISOString()
      },
      style
    }),
    signal
  })

  if (!response.ok) {
    const errorPayload = await response.text()
    throw new Error(`AI 프록시 호출 실패: ${errorPayload}`)
  }

  const data = await response.json()
  if (!data?.message) {
    throw new Error('AI 프록시 응답에서 메시지를 찾을 수 없습니다.')
  }

  return data.message as string
}
