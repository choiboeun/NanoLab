import type { FormEvent } from 'react'
import { useState } from 'react'
import type { TodoItem } from '../App'

type TodoFormState = {
  name: string
  deadline: string
  estimatedTime: string
}

type TodoInputFormProps = {
  addTodo: (todo: Omit<TodoItem, 'id' | 'priority' | 'completedAt'>) => Promise<void> | void
}

const createInitialState = (): TodoFormState => ({
  name: '',
  deadline: '',
  estimatedTime: '',
})

export function TodoInputForm({ addTodo }: TodoInputFormProps) {
  const [form, setForm] = useState<TodoFormState>(() => createInitialState())
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const payload = {
      name: form.name.trim(),
      deadline: form.deadline ? new Date(form.deadline) : null,
      estimatedTime: form.estimatedTime ? Number(form.estimatedTime) : null,
      createdAt: new Date()
    }

    if (!payload.name) {
      const message = '할 일 이름을 입력해 주세요.'
      setError(message)
      console.error(message)
      return
    }

    setError('')
    setForm(createInitialState())

    try {
      await addTodo(payload)
      console.log('새 할 일:', payload)
    } catch (err) {
      console.error('할 일을 추가하는 중 오류가 발생했습니다.', err)
      setForm({
        name: payload.name,
        deadline: payload.deadline ? payload.deadline.toISOString().slice(0, 16) : '',
        estimatedTime:
          typeof payload.estimatedTime === 'number' && !Number.isNaN(payload.estimatedTime)
            ? String(payload.estimatedTime)
            : '',
      })
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-8 text-left shadow-xl shadow-slate-200"
    >
      <header className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-500">새 할 일</p>
        <h2 className="text-2xl font-semibold text-slate-900">PlanShock Todo 입력</h2>
        <p className="text-sm text-slate-500">마감과 예상 시간을 입력하면 우선순위를 정하기 쉬워집니다.</p>
      </header>

      <label className="space-y-2 text-sm font-medium text-slate-700">
        할 일 이름
        <input
          required
          name="name"
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          type="text"
          placeholder="예: 사용자 온보딩 플로우 점검"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
        {error && <p className="text-xs font-medium text-red-500">{error}</p>}
      </label>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-700">
          마감 시간
          <input
            name="deadline"
            value={form.deadline}
            onChange={(event) => setForm((prev) => ({ ...prev, deadline: event.target.value }))}
            type="datetime-local"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          예상 소요 시간 (시간)
          <input
            min="0"
            step="0.5"
            name="estimatedTime"
            value={form.estimatedTime}
            onChange={(event) => setForm((prev) => ({ ...prev, estimatedTime: event.target.value }))}
            type="number"
            placeholder="예: 4"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </label>
      </div>

      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-5 py-3 text-base font-semibold text-white transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        할 일 추가하기
      </button>
    </form>
  )
}

export default TodoInputForm
