export interface TodoItem {
  title: string
  dueDate: Date
  estimatedTime: number
  createdAt: Date
}

export type NagStyle =
  | '개빡센 잔소리형'
  | '비꼬는 친구형'
  | '팩트폭격 교수형'
  | '귀엽지만 할 말 다하는형'
  | '츤데레형'

export type NagRule = 'CRITICAL' | 'PROCRASTINATING' | 'NORMAL'

type TemplateContext = {
  title: string
  dueDurationText: string
  elapsedDurationText: string
  overdue: boolean
  estimatedTime: number
}

const ONE_MINUTE = 60 * 1000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

export const formatDuration = (ms: number): string => {
  const isNegative = ms < 0
  const abs = Math.abs(ms)
  const days = Math.floor(abs / ONE_DAY)
  const hours = Math.floor((abs % ONE_DAY) / ONE_HOUR)
  const minutes = Math.floor((abs % ONE_HOUR) / ONE_MINUTE)

  const parts: string[] = []
  if (days) parts.push(`${days}일`)
  if (hours || days) parts.push(`${hours}시간`)
  parts.push(`${minutes}분`)

  const result = parts.join(' ')
  return isNegative ? `-${result}` : result
}

export const determineNagRule = (todo: TodoItem, now: Date): NagRule => {
  const timeUntilDue = todo.dueDate.getTime() - now.getTime()
  if (timeUntilDue <= ONE_DAY) return 'CRITICAL'

  const timeSinceCreated = now.getTime() - todo.createdAt.getTime()
  if (timeSinceCreated >= 2 * ONE_DAY) return 'PROCRASTINATING'

  return 'NORMAL'
}

const templates: Record<NagStyle, Record<NagRule, (ctx: TemplateContext) => string>> = {
  '개빡센 잔소리형': {
    CRITICAL: ({ title, dueDurationText, overdue, estimatedTime }) =>
      overdue
        ? `야 "${title}" 마감 지나고도 멀뚱멀뚱? ${estimatedTime}시간도 못 뺄 정도면 그냥 다시 태어나.`
        : `지금 "${title}" 마감까지 ${dueDurationText} 남았다고? ${estimatedTime}시간이면 반도 못 한다. 당장 착수해.`,
    PROCRASTINATING: ({ title, elapsedDurationText }) =>
      `"${title}" 입력해둔 지 ${elapsedDurationText} 지나도록 아무것도 안 했다니… 진짜 대단하다. 기적이야. 이 기세로 계속 망할래?`,
    NORMAL: ({ title, estimatedTime }) =>
      `"${title}" 같은 건 ${estimatedTime}시간이면 끝나. 쓸데없는 걱정 말고 키보드부터 두드려.`
  },
  '비꼬는 친구형': {
    CRITICAL: ({ title, dueDurationText, overdue }) =>
      overdue
        ? `헐 "${title}" 마감 이미 지나버렸네? 괜찮아, 넌 늘 그랬으니까. 이번에도 기적 믿어볼래?`
        : `"${title}" ${dueDurationText} 남았다고 여유 부리는 중? 역시 시간 관리의 신답다~`,
    PROCRASTINATING: ({ title, elapsedDurationText }) =>
      `"${title}" 넣어둔 지 ${elapsedDurationText} 지났는데 아직도 그대로라니… 마치 박제해놓은 계획 같아.`,
    NORMAL: ({ title, estimatedTime }) =>
      `"${title}"는 ${estimatedTime}시간이면 끝난다며? 말로만 그러지 말고, 몸도 좀 움직여 봐~`
  },
  '팩트폭격 교수형': {
    CRITICAL: ({ title, dueDurationText, overdue }) =>
      overdue
        ? `"${title}"는 이미 마감이 경과했다. 이는 계획 대비 치명적인 지연이다. 즉각적인 조치가 필요하다.`
        : `"${title}" 마감까지 ${dueDurationText} 남았다. 예상 소요 시간을 감안하면 지금 착수하지 않으면 목표 달성이 불가능하다.`,
    PROCRASTINATING: ({ title, elapsedDurationText }) =>
      `"${title}"는 생성 후 ${elapsedDurationText} 동안 미완료 상태다. 이는 습관적 미루기의 전형적 증거다.`,
    NORMAL: ({ title, estimatedTime }) =>
      `"${title}" 예상 소요 ${estimatedTime}시간. 지금 시작하면 일정 오차를 최소화할 수 있다. 데이터를 믿어라.`
  },
  '귀엽지만 할 말 다하는형': {
    CRITICAL: ({ title, dueDurationText, overdue }) =>
      overdue
        ? `으앗! "${title}" 마감 지나버렸어! 그래도 지금 하면 일정 다시 잡을 수 있으니까 얼른 하자!`
        : `"${title}" 마감까지 ${dueDurationText}! 조금만 집중하면 충분히 해낼 수 있어. 같이 힘내자!`,
    PROCRASTINATING: ({ title, elapsedDurationText }) =>
      `"${title}" 만든 지 ${elapsedDurationText}이나 됐네? 슬슬 다시 시작해볼까? 난 네가 꼭 해낼 거라고 믿어!`,
    NORMAL: ({ title }) =>
      `"${title}" 지금 시작하면 나중에 훨씬 편해질 거야. 얼른 해치우고 쉬자~`
  },
  '츤데레형': {
    CRITICAL: ({ title, dueDurationText, overdue }) =>
      overdue
        ? `…"${title}" 마감 넘겼어. 너답게 또 막판에 우는 소리하려고? 그 전에 빨리 해버려.`
        : `"${title}" ${dueDurationText} 남았다고 설렁설렁하지 마. 네가 얼마나 잘 미루는지 내가 알잖아.`,
    PROCRASTINATING: ({ title, elapsedDurationText }) =>
      `"${title}" 만든 지 ${elapsedDurationText}이나 됐는데 아직도 그대로야? 참… 그래도 포기하지 말고 지금 시작해.`,
    NORMAL: ({ title, estimatedTime }) =>
      `"${title}" 정도는 금방이잖아. ${estimatedTime}시간도 안 쓰는 거 뻔히 알면서 왜 미루니? 지금 조용히 끝내.`
  }
}

export const generateNagMessage = (todo: TodoItem, style: NagStyle): string => {
  const now = new Date()
  const rule = determineNagRule(todo, now)

  const context: TemplateContext = {
    title: todo.title,
    dueDurationText: formatDuration(todo.dueDate.getTime() - now.getTime()),
    elapsedDurationText: formatDuration(now.getTime() - todo.createdAt.getTime()),
    overdue: todo.dueDate.getTime() <= now.getTime(),
    estimatedTime: todo.estimatedTime
  }

  const template = templates[style][rule]
  return template(context)
}
