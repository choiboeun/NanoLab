import { useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { PriorityRank, TodoItem } from '../App'

type TodoCalendarProps = {
  todos: TodoItem[]
}

const priorityBadge: Record<'충격' | '경고' | '안전', { label: string; className: string }> = {
  충격: { label: '충격', className: 'bg-red-100 text-red-700 border-red-200' },
  경고: { label: '경고', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  안전: { label: '안전', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
}

const toCanonical = (priority: PriorityRank | string): '충격' | '경고' | '안전' => {
  if (priority === '충격' || priority === '경고' || priority === '안전') return priority
  if (priority === 'legacy-critical' || priority === 'i¶©e²©') return '충격'
  if (
    priority === 'legacy-warning' ||
    priority === 'e²½e³?' ||
    priority === 'ê²½ê³ ' ||
    priority === 'e²½e³ ' ||
    priority === 'legacy-safe'
  ) {
    return priority === 'legacy-safe' ? '안전' : '경고'
  }
  return '안전'
}

export function TodoCalendar({ todos }: TodoCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const start = startOfWeek(monthStart, { weekStartsOn: 0 })
    const end = endOfWeek(monthEnd, { weekStartsOn: 0 })

    return eachDayOfInterval({ start, end })
  }, [currentMonth])

  const todosByDate = useMemo(() => {
    const map = new Map<string, TodoItem[]>()
    todos.forEach((todo) => {
      if (!todo.deadline) return
      const key = format(todo.deadline, 'yyyy-MM-dd')
      const existing = map.get(key) ?? []
      existing.push(todo)
      map.set(key, existing)
    })
    return map
  }, [todos])

  return (
    <div className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-md shadow-slate-100">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:border-slate-300"
          onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))}
        >
          이전
        </button>
        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900">{format(currentMonth, 'yyyy년 M월')}</p>
          <p className="text-xs text-slate-500">마감 일정과 완료 현황을 한눈에 확인하세요</p>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:border-slate-300"
          onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
        >
          다음
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
          <div key={day} className="py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {calendarDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const dayTodos = todosByDate.get(key) ?? []
          const isCurrentMonthDay = isSameMonth(day, currentMonth)
          const isToday = isSameDay(day, new Date())

          return (
            <div
              key={key}
              className={`min-h-[7rem] rounded-2xl border p-2 text-left transition ${
                isCurrentMonthDay ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 text-slate-400'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-sm font-semibold ${isToday ? 'text-emerald-600' : 'text-slate-700'}`}>
                  {format(day, 'd')}
                </span>
                {isToday && <span className="text-[10px] font-semibold text-emerald-600">오늘</span>}
              </div>
              <div className="space-y-1">
                {dayTodos.length === 0 ? (
                  <p className="text-[11px] text-slate-400">일정 없음</p>
                ) : (
                  dayTodos.map((todo) => {
                    const canonical = toCanonical(todo.priority)
                    const badge = priorityBadge[canonical]
                    return (
                      <div
                        key={todo.id}
                        className={`rounded-xl border px-2 py-1 text-[11px] leading-tight ${
                          todo.completedAt ? 'opacity-60 line-through' : ''
                        } ${badge.className}`}
                      >
                        <p className="font-semibold">{todo.name}</p>
                        {todo.completedAt ? (
                          <p className="text-[10px] text-slate-500">완료됨</p>
                        ) : (
                          <p className="text-[10px]">{badge.label}</p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TodoCalendar
