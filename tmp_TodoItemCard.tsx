import { useCallback, useEffect, useRef, useState } from 'react'
import type { PriorityRank, TodoItem } from '../App'
import { determineNagRule, formatDuration, type NagStyle, type NagRule } from '../utils/nagMessages'
import { fetchAiNagMessage } from '../utils/aiNagMessage'

type TodoItemCardProps = {
  todo: TodoItem
  priority: PriorityRank
  deleteTodo: (id: string) => void
  selectedStyle: NagStyle
  toggleTodoCompletion: (id: string, completed: boolean) => Promise<void> | void
  notificationsEnabled: boolean
  speechEnabled: boolean
  onSpeak: (message: string, style?: NagStyle, options?: { interrupt?: boolean }) => Promise<void>
}

const HOUR_MS = 60 * 60 * 1000
const HALF_HOUR_MS = 30 * 60 * 1000
const INITIAL_EVENT_SKIP_WINDOW_MS = 60 * 1000

const PRE_DEADLINE_THRESHOLDS_ASC = [
  { key: 'pre-30m', ms: HALF_HOUR_MS },
  { key: 'pre-1h', ms: 1 * HOUR_MS },
  { key: 'pre-2h', ms: 2 * HOUR_MS },
  { key: 'pre-3h', ms: 3 * HOUR_MS },
  { key: 'pre-4h', ms: 4 * HOUR_MS },
  { key: 'pre-5h', ms: 5 * HOUR_MS },
]

const POST_DEADLINE_THRESHOLDS_ASC = [
  { key: 'post-1h', ms: 1 * HOUR_MS },
  { key: 'post-6h', ms: 6 * HOUR_MS },
  { key: 'post-24h', ms: 24 * HOUR_MS },
]

const calculateLocalPriority = (deadline: Date | null, estimatedTime: number | null): PriorityRank => {
  if (!deadline) return '안전'
  const remainingHours = (deadline.getTime() - Date.now()) / HOUR_MS
  if (remainingHours <= 0) return '충격'

  if (estimatedTime == null) {
    if (remainingHours <= 6) return '충격'
    if (remainingHours <= 24) return '경고'
    return '안전'
  }

  if (remainingHours < estimatedTime) return '충격'
  if (remainingHours < estimatedTime * 2) return '경고'
  return '안전'
}

const getPriorityStyles = (priority: PriorityRank) => {
  switch (priority) {
    case '충격':
      return {
        badgeClass: 'bg-red-100 text-red-700 border border-red-200',
        icon: '?',
        label: '충격'
      }
    case '경고':
      return {
        badgeClass: 'bg-amber-100 text-amber-700 border border-amber-200',
        icon: '??',
        label: '경고'
      }
    default:
      return {
        badgeClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
        icon: '?',
        label: '안전'
      }
  }
}

const formatDeadline = (deadline: Date | null) => {
  if (!deadline) return '기한 없음'
  const date = new Date(deadline)
  if (Number.isNaN(date.getTime())) return '잘못된 날짜'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const formatEstimatedTime = (hours: number | null) => {
  if (hours === null || Number.isNaN(hours)) return '미입력'
  return `${hours}시간`
}

export function TodoItemCard({
  todo,
  priority,
  deleteTodo,
  selectedStyle,
  toggleTodoCompletion,
  notificationsEnabled,
  speechEnabled,
  onSpeak
}: TodoItemCardProps) {
  const priorityStyles = getPriorityStyles(priority)
  const [isConfirming, setIsConfirming] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [isLoadingMessage, setIsLoadingMessage] = useState(false)
  const [nagRefreshKey, setNagRefreshKey] = useState(0)
  const pendingSpeechKeyRef = useRef<number | null>(null)
  const [remainingText, setRemainingText] = useState(() => {
    if (!todo.deadline) return '기한 없음'
    const diff = todo.deadline.getTime() - Date.now()
    return diff <= 0
      ? `마감 지남 (${formatDuration(Math.abs(diff))} 지각)`
      : formatDuration(diff)
  })
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasSkippedInitialEventRef = useRef(false)
  const prevStyleRef = useRef<NagStyle>(selectedStyle)
  const prevPriorityRef = useRef<PriorityRank>(
    calculateLocalPriority(todo.deadline ?? null, todo.estimatedTime ?? null),
  )
  const initialPriorityRef = useRef<PriorityRank>(priority)
  const prevRemainingRef = useRef<number | null>(todo.deadline ? todo.deadline.getTime() - Date.now() : null)
  const triggeredThresholdsRef = useRef<Set<string>>(new Set())
  const lastSpeechKeyRef = useRef(-1)
  const lastLoadedKeyRef = useRef<number | null>(null)

  const nagPayload = {
    title: todo.name || '이름 없는 할 일',
    dueDate: todo.deadline ? new Date(todo.deadline) : new Date(Date.now() + 60 * 60 * 1000),
    estimatedTime: todo.estimatedTime ?? 1,
    createdAt: todo.createdAt ? new Date(todo.createdAt) : new Date()
  }

  const isCompleted = Boolean(todo.completedAt)
  const rule = determineNagRule(nagPayload, new Date())
  const isCriticalPriority = priority === '충격'
  const [shouldShowNag, setShouldShowNag] = useState(() => !isCompleted && priority !== '안전')
  const displayMessage = shouldShowNag ? aiMessage : null

  const requestNagRefresh = useCallback(
    (forcePlay = false) => {
      setNagRefreshKey((value) => {
        const next = value + 1
        if (!forcePlay) {
          pendingSpeechKeyRef.current = next
        }
        return next
      })
    },
    [],
  )

  const triggerNotification = (message: string) => {
    if (!notificationsEnabled || typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const title = todo.name || 'PlanShock 알림'
    new Notification(title, { body: message })
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    if (!shouldShowNag) {
      setAiMessage(null)
      setAiError(null)
      setIsLoadingMessage(false)
      return () => controller.abort()
    }

    setIsLoadingMessage(true)
    setAiMessage(null)
    setAiError(null)

    fetchAiNagMessage(nagPayload, selectedStyle, controller.signal)
      .then((message) => {
        if (!cancelled) {
          setAiMessage(message)
          setIsLoadingMessage(false)
          lastLoadedKeyRef.current = nagRefreshKey
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('AI 잔소리 생성 실패:', error)
          setAiError(error instanceof Error ? error.message : '알 수 없는 오류')
          setIsLoadingMessage(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [todo.id, selectedStyle, rule, shouldShowNag, isCompleted, nagRefreshKey])

  useEffect(() => {
    if (!shouldShowNag || !displayMessage || isCompleted) return

    const styleJustChanged = prevStyleRef.current !== selectedStyle
    prevStyleRef.current = selectedStyle

    if (styleJustChanged) {
      lastSpeechKeyRef.current = nagRefreshKey
      pendingSpeechKeyRef.current = null
      return
    }

    if (
      pendingSpeechKeyRef.current !== null &&
      pendingSpeechKeyRef.current === nagRefreshKey &&
      lastLoadedKeyRef.current === nagRefreshKey &&
      lastSpeechKeyRef.current !== nagRefreshKey
    ) {
      if (!hasSkippedInitialEventRef.current) {
        const createdAtMs = todo.createdAt ? todo.createdAt.getTime() : null
        const withinWindow = createdAtMs && Date.now() - createdAtMs < INITIAL_EVENT_SKIP_WINDOW_MS
        const shouldSkipInitial =
          withinWindow && initialPriorityRef.current !== '안전' && initialPriorityRef.current === priority
        if (shouldSkipInitial) {
          hasSkippedInitialEventRef.current = true
          lastSpeechKeyRef.current = nagRefreshKey
          pendingSpeechKeyRef.current = null
          return
        }
        hasSkippedInitialEventRef.current = true
      }

      if (notificationsEnabled) {
        triggerNotification(displayMessage)
      }
      if (speechEnabled && shouldShowNag) {
        onSpeak(displayMessage, selectedStyle, { interrupt: true }).catch((error) =>
          console.error('TTS 재생 실패:', error),
        )
      }
      lastSpeechKeyRef.current = nagRefreshKey
      pendingSpeechKeyRef.current = null
    }
  }, [
    displayMessage,
    notificationsEnabled,
    speechEnabled,
    isCompleted,
    onSpeak,
    selectedStyle,
    todo.createdAt,
    nagRefreshKey,
    shouldShowNag,
  ])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    hasSkippedInitialEventRef.current = false
    const initialPriority = calculateLocalPriority(todo.deadline ?? null, todo.estimatedTime ?? null)
    prevPriorityRef.current = initialPriority
    setShouldShowNag(!isCompleted && initialPriority !== '안전')
    prevRemainingRef.current = todo.deadline ? todo.deadline.getTime() - Date.now() : null
    triggeredThresholdsRef.current.clear()
    lastSpeechKeyRef.current = -1
    initialPriorityRef.current = initialPriority
  }, [todo.id, todo.deadline ? todo.deadline.getTime() : null, todo.estimatedTime, isCompleted])

  const handleDeleteClick = () => {
    if (!isConfirming) {
      console.warn('정말로 이 할 일을 삭제하시겠습니까? 2초 안에 다시 누르면 삭제됩니다.')
      setIsConfirming(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        setIsConfirming(false)
        resetTimerRef.current = null
      }, 2000)
      return
    }

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    deleteTodo(todo.id)
    setIsConfirming(false)
  }

  useEffect(() => {
    if (!todo.deadline) {
      setRemainingText('기한 없음')
      prevRemainingRef.current = null
      return
    }

    const triggerNagEvent = () => {
      requestNagRefresh()
      return true
    }

    const evaluateSchedule = (diff: number) => {
      if (isCompleted) {
        prevRemainingRef.current = diff
        triggeredThresholdsRef.current.clear()
        return
      }

      const livePriority = calculateLocalPriority(todo.deadline, todo.estimatedTime ?? null)
      const prevPriority = prevPriorityRef.current
      let eventTriggered = false

      if (prevPriority !== livePriority) {
        if (prevPriority === '안전' && livePriority === '경고') {
          eventTriggered = triggerNagEvent() || eventTriggered
        } else if (prevPriority !== '충격' && livePriority === '충격') {
          eventTriggered = triggerNagEvent() || eventTriggered
        }
        setShouldShowNag(!isCompleted && livePriority !== '안전')
        if (livePriority !== '충격') {
          triggeredThresholdsRef.current.clear()
        }
        prevPriorityRef.current = livePriority
      }

      if (livePriority !== '충격') {
        prevRemainingRef.current = diff
        return
      }

      if (!eventTriggered && livePriority === '충격') {
        const prevDiff = prevRemainingRef.current
        if (diff >= 0) {
          for (const threshold of PRE_DEADLINE_THRESHOLDS_ASC) {
            const prevAbove = prevDiff == null ? true : prevDiff > threshold.ms
            if (prevAbove && diff <= threshold.ms && !triggeredThresholdsRef.current.has(threshold.key)) {
              triggeredThresholdsRef.current.add(threshold.key)
              eventTriggered = triggerNagEvent() || eventTriggered
              break
            }
          }
          const prevPositive = prevDiff == null ? true : prevDiff > 0
          if (prevPositive && diff <= 0 && !triggeredThresholdsRef.current.has('deadline-hit')) {
            triggeredThresholdsRef.current.add('deadline-hit')
            eventTriggered = triggerNagEvent() || eventTriggered
          }
        } else {
          const prevElapsed = prevDiff == null ? 0 : Math.max(0, -prevDiff)
          const elapsed = Math.abs(diff)
          for (const threshold of POST_DEADLINE_THRESHOLDS_ASC) {
            const prevBelow = prevElapsed < threshold.ms
            if (prevBelow && elapsed >= threshold.ms && !triggeredThresholdsRef.current.has(threshold.key)) {
              triggeredThresholdsRef.current.add(threshold.key)
              eventTriggered = triggerNagEvent() || eventTriggered
              break
            }
          }
        }
      }

      prevRemainingRef.current = diff
    }

    const calc = () => {
      const diff = todo.deadline!.getTime() - Date.now()
      setRemainingText(
        diff <= 0 ? `마감 지남 (${formatDuration(Math.abs(diff))} 지각)` : formatDuration(diff),
      )
      evaluateSchedule(diff)
    }

    calc()
    const interval = setInterval(calc, 60 * 1000)
    return () => clearInterval(interval)
  }, [todo.deadline ? todo.deadline.getTime() : null, todo.estimatedTime, isCompleted])

  return (
    <article
      className={`mx-auto flex max-w-xl flex-col gap-4 rounded-3xl border p-5 shadow-lg shadow-slate-200 transition ${
        isCompleted
          ? 'bg-slate-100 border-slate-200 text-slate-500 line-through'
          : `hover:-translate-y-0.5 hover:shadow-xl ${
              isCriticalPriority ? 'bg-red-500/10 border-red-200' : 'bg-white/80 border-slate-200'
            }`
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-slate-900">{todo.name || '제목 없음'}</h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${priorityStyles.badgeClass}`}
            >
              <span aria-hidden="true">{priorityStyles.icon}</span>
              {priorityStyles.label}
            </span>
          </div>
          <div className="mt-2 min-h-[52px]">
            {shouldShowNag ? (
              <p className="text-base font-semibold text-red-600">
                {displayMessage ??
                  (aiError
                    ? `AI 잔소리 생성 실패: ${aiError}`
                    : isLoadingMessage
                      ? 'AI가 잔소리를 준비 중...'
                      : null)}
              </p>
            ) : (
              <p className="text-sm text-slate-400">여유 있을 때도 방심하면 다시 충격 상태로 떨어집니다.</p>
            )}
          </div>
          <p className="text-sm text-slate-500">남은 시간: {remainingText}</p>
        </div>
        <div className="flex w-[120px] flex-col items-stretch gap-2">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
              checked={isCompleted}
              onChange={(event) => toggleTodoCompletion(todo.id, event.target.checked)}
            />
            완료
          </label>
          <button
            type="button"
            onClick={handleDeleteClick}
            className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-600 transition hover:bg-red-100"
          >
            {isConfirming ? '정말로 삭제?' : '삭제'}
          </button>
        </div>
      </div>
      <dl className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">예상 시간</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{formatEstimatedTime(todo.estimatedTime)}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">마감</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{formatDeadline(todo.deadline)}</dd>
        </div>
      </dl>
    </article>
  )
}

export default TodoItemCard
