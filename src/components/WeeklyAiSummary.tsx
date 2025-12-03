import { useEffect, useMemo, useState } from 'react'
import type { TodoItem } from '../App'
import { addDays, addHours, format } from 'date-fns'

type WeeklyAiSummaryProps = {
  todos: TodoItem[]
}

type StoredSummary = {
  weekStart: string
  message: string
  fetchedAt: string
}

const STORAGE_KEY = 'planshock-weekly-summary'

const getCurrentWindowStart = (reference: Date) => {
  const result = new Date(reference)
  const day = result.getDay() // 0 = Sunday ... 6 = Saturday
  const diff = (day - 6 + 7) % 7 // days since last Saturday
  result.setDate(result.getDate() - diff)
  result.setHours(0, 0, 0, 0)
  return result
}

export function WeeklyAiSummary({ todos }: WeeklyAiSummaryProps) {
  const now = new Date()
  const weeklyWindowStart = useMemo(() => getCurrentWindowStart(now), [now.getFullYear(), now.getMonth(), now.getDate()])
  const weeklyWindowEnd = useMemo(() => addHours(weeklyWindowStart, 3), [weeklyWindowStart])
  const nextWindowStart = useMemo(() => addDays(weeklyWindowStart, 7), [weeklyWindowStart])
  const inWeeklyWindow = now >= weeklyWindowStart && now < weeklyWindowEnd

  const [message, setMessage] = useState<string>('이번 주 요약은 토요일 00:00~03:00 사이에 자동 갱신됩니다.')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cachedSummary, setCachedSummary] = useState<StoredSummary | null>(null)
  const summaryEndpoint = useMemo(() => {
    const explicit = import.meta.env.VITE_AI_SUMMARY_URL
    if (explicit && explicit.trim().length > 0) return explicit.trim()

    const shared = import.meta.env.VITE_AI_PROXY_URL
    if (shared && shared.includes('nag-message')) {
      return shared.replace('nag-message', 'ai-summary')
    }
    if (shared && shared.trim().length > 0) return shared.trim()
    return '/api/ai-summary'
  }, [])

  const windowStartISO = weeklyWindowStart.toISOString()
  const hasCurrentSummary = cachedSummary?.weekStart === windowStartISO

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const stored: StoredSummary = JSON.parse(raw)
      setCachedSummary(stored)
      setMessage(stored.message)
    } catch (err) {
      console.warn('Failed to load cached weekly summary.', err)
    }
  }, [])

  useEffect(() => {
    if (!inWeeklyWindow || hasCurrentSummary) return

    const summarize = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const summaryPayload = todos.map((todo) => ({
          title: todo.name,
          completedAt: todo.completedAt ? format(todo.completedAt, 'yyyy-MM-dd HH:mm') : null,
          priority: todo.priority,
        }))

        const response = await fetch(summaryEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            todos: summaryPayload,
          }),
        })
        if (!response.ok) throw new Error(await response.text())
        const data = await response.json()
        const nextSummary: StoredSummary = {
          weekStart: windowStartISO,
          message: data.message + ' (기계 해석)',
          fetchedAt: new Date().toISOString(),
        }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSummary))
        }
        setCachedSummary(nextSummary)
        setMessage(nextSummary.message)
      } catch (err) {
        setError('AI 요약을 가져오는 중 오류가 발생했습니다.')
      } finally {
        setIsLoading(false)
      }
    }

    summarize()
  }, [hasCurrentSummary, inWeeklyWindow, summaryEndpoint, todos, windowStartISO])

  return (
    <div className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow">
      <h2 className="mb-2 text-lg font-semibold text-slate-900">이번 주 PlanShock AI 요약</h2>
      {inWeeklyWindow && !hasCurrentSummary && (
        <p className="mb-1 text-xs text-emerald-500">지금이 주간 요약 생성 시간입니다. 최신 데이터를 계산 중...</p>
      )}
      {isLoading ? (
        <p className="text-sm text-slate-500">AI가 요약을 준비 중...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : (
        <p className="text-sm text-slate-700">{message}</p>
      )}
      <p className="mt-2 text-xs text-slate-400">
        다음 자동 갱신: 토요일 00:00~03:00 (
        {format(nextWindowStart, 'yyyy.MM.dd HH:mm')} 기준)
      </p>
    </div>
  )
}

export default WeeklyAiSummary
