import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FirebaseApp, FirebaseOptions } from 'firebase/app'
import { getApps, initializeApp } from 'firebase/app'
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  type Auth,
} from 'firebase/auth'
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'

import { TodoInputForm } from './components/TodoInputForm'
import { TodoList } from './components/TodoList'
import { TodoCalendar } from './components/TodoCalendar'
import { HabitCharts } from './components/HabitCharts'
import { WeeklyAiSummary } from './components/WeeklyAiSummary'
import { UsageGuideModal } from './components/UsageGuideModal'
import type { NagStyle } from './utils/nagMessages'
import { formatDuration } from './utils/nagMessages'

const LEGACY_CRITICAL = 'legacy-critical' as const
const LEGACY_WARNING = 'legacy-warning' as const
const LEGACY_SAFE = 'legacy-safe' as const

export type PriorityRank =
  | '충격'
  | '경고'
  | '안전'
  | typeof LEGACY_CRITICAL
  | typeof LEGACY_WARNING
  | typeof LEGACY_SAFE

export interface TodoItem {
  id: string
  name: string
  deadline: Date | null
  estimatedTime: number | null
  priority: PriorityRank
  createdAt: Date | null
  completedAt: Date | null
}

const STYLE_OPTIONS: NagStyle[] = [
  '개빡센 잔소리형',
  '비꼬는 친구형',
  '팩트폭격 교수형',
  '귀엽지만 할 말 다하는형',
  '츤데레형',
]

const STYLE_PRESETS: Record<NagStyle, { rate: number; volume: number }> = {
  '개빡센 잔소리형': { rate: 1.15, volume: 1 },
  '비꼬는 친구형': { rate: 1.1, volume: 0.95 },
  '팩트폭격 교수형': { rate: 1, volume: 1 },
  '귀엽지만 할 말 다하는형': { rate: 1.2, volume: 0.9 },
  '츤데레형': { rate: 0.95, volume: 0.85 },
}

const LEGACY_PRIORITY_MAP: Record<'충격' | '경고' | '안전', PriorityRank> = {
  충격: LEGACY_CRITICAL,
  경고: LEGACY_WARNING,
  안전: LEGACY_SAFE,
}

const PRIORITY_ALIAS_MAP: Record<string, '충격' | '경고' | '안전'> = {
  충격: '충격',
  경고: '경고',
  안전: '안전',
  [LEGACY_CRITICAL]: '충격',
  [LEGACY_WARNING]: '경고',
  [LEGACY_SAFE]: '안전',
  'ì¶©ê²©': '충격',
  'e²½e³?': '경고',
  'ê²½ê³ ': '경고',
  'e²½e³ ': '경고',
}

const LEGACY_TO_CANONICAL: Record<PriorityRank, '충격' | '경고' | '안전'> = {
  [LEGACY_CRITICAL]: '충격',
  [LEGACY_WARNING]: '경고',
  [LEGACY_SAFE]: '안전',
  충격: '충격',
  경고: '경고',
  안전: '안전',
}

const PRE_DEADLINE_REMINDER_MS = 30 * 60 * 1000
const CRITICAL_THRESHOLD_HOURS = 6
const WARNING_THRESHOLD_HOURS = 24
const normalizeEstimatedTime = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
const STRESS_WAVE_KEYFRAMES = `                                               
@keyframes stressWave {                                                       
  0% { transform: translateX(-30%); }                                         
  50% { transform: translateX(15%); }                                         
  100% { transform: translateX(-30%); }                                       
}`

const TTS_ENDPOINT_FALLBACK = '/api/tts-nag'

const priorityOrderWeight: Record<'충격' | '경고' | '안전', number> = {
  충격: 1,
  경고: 2,
  안전: 3,
}

const prioritySortWeight = (priority: PriorityRank): number =>
  priorityOrderWeight[LEGACY_TO_CANONICAL[priority] ?? '안전']

type FirestoreTodoPayload = {
  name?: string
  deadline?: Date | Timestamp | string | null
  estimatedTime?: number | null
  priority?: PriorityRank
  createdAt?: Date | Timestamp | string | null
  completedAt?: Date | Timestamp | string | null
  userId?: string
}

type SpeechQueueItem = {
  message: string
  style: NagStyle
  resolve: () => void
  reject: (error: Error) => void
}

const toLegacyPriority = (value: '충격' | '경고' | '안전'): PriorityRank => 
  LEGACY_PRIORITY_MAP[value] ?? value

const toCanonicalPriority = (value: PriorityRank | string): '충격' | '경고' | '안전' =>
  PRIORITY_ALIAS_MAP[value as string] ?? '안전'

const calculatePriority = (deadline: Date | null, _estimatedTime: number | null): PriorityRank => {
  if (!deadline) return toLegacyPriority('안전')

  const hoursLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60)
  if (hoursLeft <= 0) return toLegacyPriority('충격')
  if (hoursLeft <= CRITICAL_THRESHOLD_HOURS) return toLegacyPriority('충격')
  if (hoursLeft <= WARNING_THRESHOLD_HOURS) return toLegacyPriority('경고')
  return toLegacyPriority('안전')
}

const formatKoreanDateTime = (value: Date | null): string => {
  if (!value) return '기한 없음'
  const safeDate = new Date(value)
  if (Number.isNaN(safeDate.getTime())) return '잘못된 날짜'
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(safeDate)
}

const formatEstimatedHours = (hours: number | null): string => {
  if (hours === null || Number.isNaN(hours)) return '미입력'
  return `${hours}시간`
}

const toDateSafe = (value: Date | Timestamp | string | null | undefined): Date | null => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value instanceof Timestamp) return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getTodayKey = (value: Date): string => {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const triggerSystemNotification = (title: string, body: string) => {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  new Notification(title, { body })
}

type PlanShockWindow = Window &
  typeof globalThis & {
    __app_id?: unknown
    __firebase_config?: unknown
    __initial_auth_token?: unknown
  }

const getPlanShockWindow = (): PlanShockWindow | null =>
  typeof window === 'undefined' ? null : ((window as unknown) as PlanShockWindow)

const getAppId = (): string => {
  const globals = getPlanShockWindow()
  if (!globals) return 'local-app'
  const raw = globals.__app_id
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'local-app'
}

const useParsedFirebaseConfig = (): FirebaseOptions | null =>
  useMemo(() => {
    const globals = getPlanShockWindow()
    if (!globals) return null
    const raw = globals.__firebase_config
    try {
      if (typeof raw === 'string' && raw.trim().length > 0) {
        const parsed = JSON.parse(raw)
        return typeof parsed === 'object' && parsed !== null ? (parsed as FirebaseOptions) : null
      }
      if (typeof raw === 'object' && raw !== null) {
        return raw as FirebaseOptions
      }
    } catch (error) {
      console.error('Failed to parse Firebase config.', error)
    }
    return null
  }, [])

const useInitialAuthToken = (): string | null =>
  useMemo(() => {
    const globals = getPlanShockWindow()
    if (!globals) return null
    try {
      const raw = globals.__initial_auth_token
      if (typeof raw !== 'string') return null
      const trimmed = raw.trim()
      return trimmed.length > 0 ? trimmed : null
    } catch (error) {
      console.error('Failed to parse initial auth token.', error)
      return null
    }
  }, [])

export function App() {
  const appId = useMemo(() => getAppId(), [])
  const firebaseConfig = useParsedFirebaseConfig()
  const initialAuthToken = useInitialAuthToken()

  const [firebaseApp, setFirebaseApp] = useState<FirebaseApp | null>(null)
  const [db, setDb] = useState<Firestore | null>(null)
  const [auth, setAuthInstance] = useState<Auth | null>(null)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [selectedStyle, setSelectedStyle] = useState<NagStyle>('개빡센 잔소리형')
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [speechEnabled, setSpeechEnabled] = useState(false)
  const [heartbeat, setHeartbeat] = useState(0)
  const [isGuideOpen, setIsGuideOpen] = useState(false)

  const notificationTimersRef = useRef<Map<string, number>>(new Map())
  const speechCacheRef = useRef<Map<string, string>>(new Map())
  const speechQueueRef = useRef<SpeechQueueItem[]>([])
  const isSpeakingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const ttsEndpoint = useMemo(
    () => import.meta.env.VITE_TTS_PROXY_URL ?? TTS_ENDPOINT_FALLBACK,
    [],
  )

  useEffect(() => {
    const timerId = window.setInterval(() => setHeartbeat((value) => value + 1), 60_000)
    return () => window.clearInterval(timerId)
  }, [])

  useEffect(() => {
    console.log('Firebase config:', firebaseConfig)
    console.log('Initial auth token:', initialAuthToken ?? '미지정')

    if (!firebaseConfig) {
      setFatalError('Firebase 설정이 존재하지 않아 PlanShock를 초기화할 수 없습니다.')
      setIsAuthReady(true)
      return
    }

    try {
      const existingApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
      setFirebaseApp(existingApp)
      const authInstance = getAuth(existingApp)
      const firestoreInstance = getFirestore(existingApp)
      setAuthInstance(authInstance)
      setDb(firestoreInstance)

      const authPromise = initialAuthToken
        ? signInWithCustomToken(authInstance, initialAuthToken)
        : signInAnonymously(authInstance)

      authPromise
        .then((credential) => {
          setUserId(credential.user.uid)
        })
        .catch((error) => {
          console.error('Firebase authentication failed.', error)
          setFatalError('PlanShock 인증 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
        })
        .finally(() => setIsAuthReady(true))
    } catch (error) {
      console.error('Firebase initialization failed.', error)
      setFatalError('Firebase 초기화 중 오류가 발생했습니다.')
      setIsAuthReady(true)
    }
  }, [firebaseConfig, initialAuthToken])

  const todosCollectionPath = useMemo(() => {
    if (!userId) return null
    return `artifacts/${appId}/users/${userId}/todos`
  }, [appId, userId])

  useEffect(() => {
    if (!db || !isAuthReady || !todosCollectionPath) return

    const todosRef = collection(db, todosCollectionPath)
    const todosQuery = query(todosRef)

    const unsubscribe = onSnapshot(
      todosQuery,
      (snapshot) => {
        try {
          const nextTodos: TodoItem[] = snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data() as FirestoreTodoPayload
            const deadline = toDateSafe(data.deadline)
            const estimatedTime = normalizeEstimatedTime(data.estimatedTime)
            const createdAt = toDateSafe(data.createdAt)
            const completedAt = toDateSafe(data.completedAt)

            return {
              id: docSnapshot.id,
              name: typeof data.name === 'string' ? data.name : '제목 없음',
              deadline,
              estimatedTime,
              createdAt,
              completedAt,
              priority: calculatePriority(deadline, estimatedTime),
            }
          })

          nextTodos.sort((a, b) => {
            if (a.completedAt && !b.completedAt) return 1
            if (!a.completedAt && b.completedAt) return -1
            const priorityDiff = prioritySortWeight(a.priority) - prioritySortWeight(b.priority)
            if (priorityDiff !== 0) return priorityDiff
            if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime()
            if (a.deadline && !b.deadline) return -1
            if (!a.deadline && b.deadline) return 1
            return a.name.localeCompare(b.name)
          })

          setTodos(nextTodos)
        } catch (error) {
          console.error('Failed to process todo documents.', error)
          setFatalError('할 일 데이터를 불러오는 중 문제가 발생했습니다.')
        }
      },
      (error) => {
        console.error('onSnapshot listener error.', error)
        setFatalError('실시간 데이터 연결에 실패했습니다.')
      },
    )

    return () => unsubscribe()
  }, [db, isAuthReady, todosCollectionPath])

  const hydratedTodos = useMemo(
    () =>
      todos.map((todo) => ({
        ...todo,
        priority: calculatePriority(todo.deadline, todo.estimatedTime),
      })),
    [todos, heartbeat],
  )

  const urgentTodo = useMemo(() => {
    const pending = hydratedTodos.filter((todo) => !todo.completedAt && todo.deadline)
    if (pending.length === 0) return null
    return [...pending].sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime())[0]
  }, [hydratedTodos])

  const stats = useMemo(() => {
    const activeCount = hydratedTodos.filter((todo) => !todo.completedAt).length
    const completedTodos = hydratedTodos.filter((todo) => todo.completedAt)
    const todayKey = getTodayKey(new Date())
    const todayCompleted = completedTodos.filter((todo) => {
      if (!todo.completedAt) return false
      return getTodayKey(todo.completedAt) === todayKey
    }).length

    return {
      activeCount,
      completedCount: completedTodos.length,
      todayCompleted,
    }
  }, [hydratedTodos])

  const stressStats = useMemo(() => {
    const active = hydratedTodos.filter((todo) => !todo.completedAt)
    const counts: Record<'충격' | '경고' | '안전', number> = { 충격: 0, 경고: 0, 안전: 0 }
    active.forEach((todo) => {
      const canonical = toCanonicalPriority(todo.priority)
      counts[canonical] += 1
    })
    const total = active.length || 1
    const stressScore = Math.round(
      ((counts.충격 * 3 + counts.경고 * 2 + counts.안전) / (total * 3)) * 100,
    )

    return {
      counts,
      totalActive: active.length,
      stressScore,
    }
  }, [hydratedTodos])

  const sortedTodos = useMemo(() => {
    const weight: Record<'충격' | '경고' | '안전', number> = { 충격: 1, 경고: 2, 안전: 3 }
    return [...hydratedTodos].sort((a, b) => {
      if (a.completedAt && !b.completedAt) return 1
      if (!a.completedAt && b.completedAt) return -1
      const diff = weight[toCanonicalPriority(a.priority)] - weight[toCanonicalPriority(b.priority)]
      if (diff !== 0) return diff
      if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime()
      if (a.deadline && !b.deadline) return -1
      if (!a.deadline && b.deadline) return 1
      return a.name.localeCompare(b.name)
    })
  }, [hydratedTodos])

  const handleAddTodo = useCallback(
    async (payload: Omit<TodoItem, 'id' | 'priority' | 'completedAt'>) => {
      if (!db || !todosCollectionPath || !userId) {
        setFatalError('데이터베이스 연결이 아직 준비되지 않았습니다.')
        return
      }

      const deadline =
        payload.deadline instanceof Date && !Number.isNaN(payload.deadline.getTime())
          ? payload.deadline
          : null
      const estimatedTime = normalizeEstimatedTime(payload.estimatedTime)

      const docPayload: FirestoreTodoPayload = {
        name: payload.name,
        deadline,
        estimatedTime,
        priority: calculatePriority(deadline, estimatedTime),
        createdAt: payload.createdAt ?? new Date(),
        completedAt: null,
        userId,
      }

      try {
        await addDoc(collection(db, todosCollectionPath), docPayload)
      } catch (error) {
        console.error('Failed to add todo.', error)
        setFatalError('할 일을 저장하는 중 오류가 발생했습니다.')
      }
    },
    [db, todosCollectionPath, userId],
  )

  const handleDeleteTodo = useCallback(
    async (id: string) => {
      if (!db || !todosCollectionPath) {
        setFatalError('데이터베이스 연결이 아직 준비되지 않았습니다.')
        return
      }

      try {
        await deleteDoc(doc(db, todosCollectionPath, id))
      } catch (error) {
        console.error('Failed to delete todo.', error)
        setFatalError('할 일을 삭제하는 중 오류가 발생했습니다.')
      }
    },
    [db, todosCollectionPath],
  )

  const handleUpdateTodo = useCallback(
    async (
      id: string,
      updates: Pick<TodoItem, 'name' | 'deadline' | 'estimatedTime'>,
    ) => {
      if (!db || !todosCollectionPath) {
        setFatalError('데이터베이스 연결이 아직 준비되지 않았습니다.')
        return
      }

      const sanitizedDeadline =
        updates.deadline instanceof Date && !Number.isNaN(updates.deadline.getTime())
          ? updates.deadline
          : null
      const sanitizedEstimate = normalizeEstimatedTime(updates.estimatedTime)

      try {
        await updateDoc(doc(db, todosCollectionPath, id), {
          name: updates.name,
          deadline: sanitizedDeadline,
          estimatedTime: sanitizedEstimate,
        })
      } catch (error) {
        console.error('Failed to update todo.', error)
        setFatalError('할 일 정보를 수정하는 중 오류가 발생했습니다.')
      }
    },
    [db, todosCollectionPath],
  )

  const handleToggleCompletion = useCallback(
    async (id: string, completed: boolean) => {
      if (!db || !todosCollectionPath) {
        setFatalError('데이터베이스 연결이 아직 준비되지 않았습니다.')
        return
      }

      try {
        await updateDoc(doc(db, todosCollectionPath, id), {
          completedAt: completed ? new Date() : null,
        })
      } catch (error) {
        console.error('Failed to update todo completion.', error)
        setFatalError('할 일 완료 상태를 업데이트하는 중 오류가 발생했습니다.')                                                                       
          }
    },
    [db, todosCollectionPath],
  )

  const flushSpeechQueue = useCallback(async () => {
    if (!speechEnabled || isSpeakingRef.current) return
    const nextJob = speechQueueRef.current.shift()
    if (!nextJob) return

    isSpeakingRef.current = true
    const cacheKey = `${nextJob.style}:${nextJob.message}`
    const preset = STYLE_PRESETS[nextJob.style] ?? { rate: 1, volume: 1 }

    try {
      let cachedUrl = speechCacheRef.current.get(cacheKey)
      if (!cachedUrl) {
        const response = await fetch(ttsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: nextJob.message, style: nextJob.style }),
        })
        if (!response.ok) throw new Error(await response.text())
        const payload = await response.json()
        cachedUrl = `data:audio/${payload.format ?? 'mp3'};base64,${payload.audioBase64}`
        speechCacheRef.current.set(cacheKey, cachedUrl)
      }

      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(cachedUrl!)
        audioRef.current = audio
        audio.playbackRate = preset.rate
        audio.volume = Math.min(1, Math.max(0, preset.volume))
        audio.onended = () => {
          audioRef.current = null
          resolve()
        }
        audio.onerror = () => {
          audioRef.current = null
          reject(new Error('오디오 재생 오류'))
        }
        audio.play().catch(reject)
      })

      nextJob.resolve()
    } catch (error) {
      console.error('TTS 재생 실패:', error)
      nextJob.reject(error instanceof Error ? error : new Error('알 수 없는 오류'))                                                                       
        } finally {
      isSpeakingRef.current = false
      if (speechQueueRef.current.length > 0) flushSpeechQueue()
    }
  }, [speechEnabled, ttsEndpoint])

  useEffect(() => {
    if (!speechEnabled) {
      speechQueueRef.current = []
      isSpeakingRef.current = false
      const currentAudio = audioRef.current
      if (currentAudio) {
        currentAudio.pause()
        currentAudio.currentTime = 0
      }
      return
    }

    flushSpeechQueue()
  }, [speechEnabled, flushSpeechQueue])

  useEffect(
    () => () => {
      const currentAudio = audioRef.current
      if (currentAudio) {
        currentAudio.pause()
        currentAudio.currentTime = 0
      }
    },
    [],
  )

  const handleSpeak = useCallback(
    (message: string, style?: NagStyle, options?: { interrupt?: boolean })=> {
      if (!speechEnabled || !message) return Promise.resolve()
      const resolvedStyle = style ?? selectedStyle

      if (options?.interrupt) {
        speechQueueRef.current = []
        const currentAudio = audioRef.current
        if (currentAudio) {
          currentAudio.pause()
          currentAudio.currentTime = 0
        }
        isSpeakingRef.current = false
      }

      return new Promise<void>((resolve, reject) => {
        speechQueueRef.current.push({
          message, style: resolvedStyle, resolve, reject })
        flushSpeechQueue()
      })
    },
    [speechEnabled, selectedStyle, flushSpeechQueue],
  )

  useEffect(() => {
    const timers = notificationTimersRef.current
    if (!notificationsEnabled && !speechEnabled) {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
      return
    }

    const pending = hydratedTodos.filter((todo) => !todo.completedAt && todo.deadline)

    timers.forEach((timerId, todoId) => {
      if (!pending.some((todo) => todo.id === todoId)) {
        window.clearTimeout(timerId)
        timers.delete(todoId)
      }
    })

    pending.forEach((todo) => {
      if (!todo.deadline || timers.has(todo.id)) return
      const triggerAt = todo.deadline.getTime() - PRE_DEADLINE_REMINDER_MS - Date.now()
      if (triggerAt <= 0) return

      const timeoutId = window.setTimeout(() => {
        const now = Date.now()
        if (todo.deadline && now >= todo.deadline.getTime()) return
        const body = `마감 30분 전! "${todo.name}"을 지금 당장 처리하세요. 남은 시간: ${formatDuration(
          Math.max(0, todo.deadline!.getTime() - now),
        )}`
        if (notificationsEnabled) {
          triggerSystemNotification(todo.name || 'PlanShock 경고', body)
        }
        timers.delete(todo.id)
      }, triggerAt)

      timers.set(todo.id, timeoutId)
    })
  }, [hydratedTodos, notificationsEnabled, speechEnabled])

  useEffect(
    () => () => {
      notificationTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      notificationTimersRef.current.clear()
    },
    [],
  )

  const toggleNotifications = () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false)
      return
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('이 브라우저는 알림을 지원하지 않습니다.')
      return
    }

    if (Notification.permission === 'granted') {
      setNotificationsEnabled(true)
      return
    }

    Notification.requestPermission().then((permission) => {
      setNotificationsEnabled(permission === 'granted')
      if (permission !== 'granted') {
        alert('알림 권한을 허용하지 않으면 브라우저 알림을 사용할 수 없습니다.')                                                                       
          }
    })
  }

  const readyState = !!(firebaseApp && db && auth && userId && !fatalError)

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 text-slate-900">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border border-emerald-200 bg-white p-10 text-center shadow-lg 
        shadow-emerald-100">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-500" />
          <p className="text-lg font-semibold text-slate-800">PlanShock 인증 및 데이터 로딩 중...</p>
          <p className="text-sm text-slate-500">PlanShock 로딩 중...</p>
        </div>
      </main>
    )
  }

  if (fatalError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 text-slate-900">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-3xl border border-red-200 bg-white p-10 text-center shadow-lg shadow-red-100">
          <p className="text-lg font-semibold text-red-600">시스템 오류</p>
          <p className="text-sm text-slate-600">{fatalError}</p>
          <p className="text-xs text-slate-400">콘솔 로그를 참고하여 관리자에
            게 문의해 주세요.</p>
        </div>
      </main>
    )
  }

  return (
    <>
      <style>{STRESS_WAVE_KEYFRAMES}</style>
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row">
          <aside className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-emerald-100 lg:sticky lg:top-10 lg:h-fit lg:w-80">
            <div>
              <p className="text-sm font-semibold text-emerald-600">PlanShock Tactical Console</p>
              <h1 className="mt-1 text-4xl font-black tracking-tight">PlanShock</h1>
              <p className="mt-3 text-xs text-slate-500">
                현재 사용자 ID:
                <span className="ml-1 font-mono text-slate-700">{userId ?? '인증 중...'}</span>
              </p>
              <button
                type="button"
                onClick={() => setIsGuideOpen(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-50">
                사용 가이드
              </button>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-slate-50/60p-4">
              <label className="flex flex-col gap-2 text-sm font-medium text- slate-700">
                잔소리 스타일 선택
                <select
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  value={selectedStyle}
                  onChange={(event) => setSelectedStyle(event.target.value as NagStyle)}
                >
                  {STYLE_OPTIONS.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">모든 카드에 동일한 잔
                  소리 톤이 적용됩니다.</span>
              </label>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={toggleNotifications}
                className={`w-full rounded-3xl border px-4 py-3 text-left shadow transition ${notificationsEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'                
                }`}                                                           
              >
              <p className="text-sm font-semibold">브라우저 알림</p>
              <p className="text-xs text-slate-500">{notificationsEnabled ?
                '활성화됨' : '비활성화됨'}</p>
            </button>

            <button
              type="button"
              onClick={() => setSpeechEnabled((prev) => !prev)}
              className={`w-full rounded-3xl border px-4 py-3 text-left shadow transition ${speechEnabled ? 'border-blue-200 bg-blue-50 text-blue-900' :
                  'border-slate-200 bg-white text-slate-700'
                }`}
            >
              <p className="text-sm font-semibold">음성 잔소리 (TTS)</p>
              <p className="text-xs text-slate-500">{speechEnabled ? '활성화됨' : '비활성화됨'}</p>
            </button>
        </div>

      <aside className="rounded-3xl border border-slate-100 bg-white/80 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">가장 긴급한 작업</p>
        {urgentTodo ? (
          <div className="mt-3 space-y-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 text-slate-800">
            <p className="text-base font-semibold">{urgentTodo.name}</p>                    
            <p className="text-xs text-slate-500">마감:
              {formatKoreanDateTime(urgentTodo.deadline)}</p>
            <p className="text-xs text-slate-500">예상 시간:
              {formatEstimatedHours(urgentTodo.estimatedTime)}</p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${toCanonicalPriority(urgentTodo.priority) === '충격'
                  ? 'bg-red-100 text-red-700 border border-red-200': toCanonicalPriority(urgentTodo.priority) === '경고'
                    ? 'bg-amber-100 text-amber-700 border border-amber-200': 'bg-emerald-50 text-emerald-600 border border-emerald-200'                                                                  
                      }`}                                                       
                    >
            {toCanonicalPriority(urgentTodo.priority)}
          </span>                                                     
                  </div>
      ) : (
      <p className="mt-3 rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
        진행 중인 긴급 작업이 없습니다.
      </p>                                                          
                )}
    </aside>
  </aside >

    <section className="flex-1 space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 p-6 text-white shadow-xl shadow-slate-300/30">
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div
            className="h-full w-[160%] rounded-full bg-gradient-to-r from-red-500/60 via-orange-400/60 to-emerald-400/60 blur-3xl"
            style={{ animation: 'stressWave 8s ease-in-out infinite' }}
          />
        </div>
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-200">PlanShock Stress Radar</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              총알 부족 지수 {stressStats.stressScore}
              <span className="ml-2 text-base font-semibold text-emerald-200">/ 100</span>
            </h2>
            <p className="mt-2 text-sm text-slate-200">
              충격 {stressStats.counts.충격} · 경고 {stressStats.counts.
                경고} · 안전 {stressStats.counts.안전} | 현재 진행{' '}
              {stressStats.totalActive}개
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2 w-10 rounded-full bg-red-400" />
              <span>위험 구간 70+</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-10 rounded-full bg-orange-300" />
              <span>경고 구간 40+</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-10 rounded-full bg-emerald-300" />
              <span>안정 구간</span>
            </div>
          </div>
        </div>
      </div>

      <div id="dashboard" className="grid gap-3 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-lg shadow-slate-100 sm:grid-cols-3">
        <div className="flex flex-col rounded-2xl bg-slate-50 px-4 py-3 text-left">
          <span className="text-xs uppercase tracking-wide text-slate-500">진행 중</span>
          <span className="text-2xl font-semibold text-slate-900">{stats.activeCount}</span>
        </div>
        <div className="flex flex-col rounded-2xl bg-slate-50 px-4 py-3 text-left">
          <span className="text-xs uppercase tracking-wide text-slate-500">완료됨</span>
          <span className="text-2xl font-semibold text-emerald-600">{stats.completedCount}</span>
        </div>
        <div className="flex flex-col rounded-2xl bg-slate-50 px-4 py-3 text-left">
          <span className="text-xs uppercase tracking-wide text-slate-500">오늘 완료</span>
          <span className="text-2xl font-semibold text-blue-600">{stats.todayCompleted}</span>
        </div>
      </div>

      <div id="planning-board" className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <TodoCalendar todos={hydratedTodos} />
          <TodoInputForm addTodo={handleAddTodo} />
          {readyState ? (
            <TodoList
              todos={sortedTodos}
              deleteTodo={handleDeleteTodo}
              selectedStyle={selectedStyle}
              toggleTodoCompletion={handleToggleCompletion}
              notificationsEnabled={notificationsEnabled}
              speechEnabled={speechEnabled}
              onSpeak={handleSpeak}
              updateTodo={handleUpdateTodo}
            />
          ) : (
            <div className="w-full rounded-3xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
              실시간 데이터를 불러오는 중입니다...
            </div>
          )}
        </div>

        <div id="insight-board" className="space-y-6">
          <WeeklyAiSummary todos={hydratedTodos} />
          <HabitCharts todos={hydratedTodos} />
        </div>
      </div>
    </section>                                                          
          </div >
        </main >

  <UsageGuideModal open={isGuideOpen} onClose={() =>
    setIsGuideOpen(false)} />                                                     
      </>                                                                       
    )                                                                           
  }

export default App
