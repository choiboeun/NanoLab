import type { TodoItem } from '../App'
import type { NagStyle } from '../utils/nagMessages'
import { TodoItemCard } from './TodoItemCard'

type TodoListProps = {
  todos: TodoItem[]
  deleteTodo: (id: string) => void
  selectedStyle: NagStyle
  toggleTodoCompletion: (id: string, completed: boolean) => Promise<void> | void
  notificationsEnabled: boolean
  speechEnabled: boolean
  onSpeak: (message: string, style?: NagStyle, options?: { interrupt?: boolean }) => Promise<void>
  updateTodo: (
    id: string,
    updates: Pick<TodoItem, 'name' | 'deadline' | 'estimatedTime'>,
  ) => Promise<void> | void
}

export function TodoList({
  todos,
  deleteTodo,
  selectedStyle,
  toggleTodoCompletion,
  notificationsEnabled,
  speechEnabled,
  onSpeak,
  updateTodo,
}: TodoListProps) {
  const activeTodos = todos.filter((todo) => !todo.completedAt)
  const completedTodos = todos.filter((todo) => Boolean(todo.completedAt))

  if (todos.length === 0) {
    return (
      <section className="flex min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-center text-base font-medium text-slate-500">
        <p className="text-2xl font-semibold text-slate-700">TODO 목록 표시 영역</p>
        <p>아직 등록된 할 일이 없습니다.</p>
      </section>
    )
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-lg shadow-slate-200">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">진행 중</h2>
        {activeTodos.length === 0 ? (
          <p className="text-sm text-slate-500">모든 할 일을 완료했습니다! 🎉</p>
        ) : (
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {activeTodos.map((todo) => (
              <TodoItemCard
                key={todo.id}
                todo={todo}
                priority={todo.priority}
                deleteTodo={deleteTodo}
                selectedStyle={selectedStyle}
                toggleTodoCompletion={toggleTodoCompletion}
                notificationsEnabled={notificationsEnabled}
                speechEnabled={speechEnabled}
                onSpeak={onSpeak}
                updateTodo={updateTodo}
              />
            ))}
          </div>
        )}
      </section>

      {completedTodos.length > 0 && (
        <section className="rounded-3xl border border-slate-100 bg-slate-50 p-6 shadow-inner shadow-slate-100">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">완료</h2>
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {completedTodos.map((todo) => (
              <TodoItemCard
                key={todo.id}
                todo={todo}
                priority={todo.priority}
                deleteTodo={deleteTodo}
                selectedStyle={selectedStyle}
                toggleTodoCompletion={toggleTodoCompletion}
                notificationsEnabled={notificationsEnabled}
                speechEnabled={speechEnabled}
                onSpeak={onSpeak}
                updateTodo={updateTodo}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default TodoList
