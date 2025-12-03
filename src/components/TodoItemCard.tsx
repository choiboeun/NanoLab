import { useCallback, useEffect, useRef, useState } from "react";
import type { PriorityRank, TodoItem } from "../App";
import {
  determineNagRule,
  formatDuration,
  type NagStyle,
} from "../utils/nagMessages";
import { fetchAiNagMessage } from "../utils/aiNagMessage";

type TodoItemCardProps = {
  todo: TodoItem;
  priority: PriorityRank;
  deleteTodo: (id: string) => void;
  selectedStyle: NagStyle;
  toggleTodoCompletion: (
    id: string,
    completed: boolean,
  ) => Promise<void> | void;
  notificationsEnabled: boolean;
  speechEnabled: boolean;
  onSpeak: (
    message: string,
    style?: NagStyle,
    options?: { interrupt?: boolean },
  ) => Promise<void>;
  updateTodo: (
    id: string,
    updates: Pick<TodoItem, "name" | "deadline" | "estimatedTime">,
  ) => Promise<void> | void;
};

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const INITIAL_EVENT_SKIP_WINDOW_MS = 60 * 1000;

const PRE_DEADLINE_THRESHOLDS_ASC = [
  { key: "pre-30m", ms: HALF_HOUR_MS },
  { key: "pre-1h", ms: HOUR_MS },
  { key: "pre-2h", ms: 2 * HOUR_MS },
  { key: "pre-3h", ms: 3 * HOUR_MS },
  { key: "pre-4h", ms: 4 * HOUR_MS },
  { key: "pre-5h", ms: 5 * HOUR_MS },
];

const POST_DEADLINE_THRESHOLDS_ASC = [
  { key: "post-1h", ms: HOUR_MS },
  { key: "post-6h", ms: 6 * HOUR_MS },
  { key: "post-24h", ms: 24 * HOUR_MS },
];

const toCanonicalPriority = (
  priority: PriorityRank | string,
): '충격' | '경고' | '안전' => {
  if (priority === '충격' || priority === '경고' || priority === '안전') return priority;
  if (priority === 'legacy-critical' || priority === 'i¶©e²©') return '충격';
  if (
    priority === 'legacy-warning' ||
    priority === 'e²½e³?' ||
    priority === 'ê²½ê³ ' ||
    priority === 'e²½e³ ' ||
    priority === 'legacy-safe'
  ) {
    return priority === 'legacy-safe' ? '안전' : '경고';
  }
  return '안전';
};

const toLegacyPriority = (priority: "충격" | "경고" | "안전"): PriorityRank => {
  if (priority === "충격") return "충격";
  if (priority === "경고") return "경고";
  return "안전";
};

const calculateLocalPriority = (
  deadline: Date | null,
  _estimatedTime: number | null,
): PriorityRank => {
  if (!deadline) return toLegacyPriority("안전");
  const remainingHours = (deadline.getTime() - Date.now()) / HOUR_MS;
  if (remainingHours <= 0) return toLegacyPriority("충격");
  if (remainingHours <= 6) return toLegacyPriority("충격");
  if (remainingHours <= 24) return toLegacyPriority("경고");
  return toLegacyPriority("안전");
};

const getPriorityStyles = (priority: PriorityRank) => {
  const canonical = toCanonicalPriority(priority);
  switch (canonical) {
    case "충격":
      return {
        badgeClass: "bg-red-100 text-red-700 border border-red-200",
        icon: "🚨",
        label: "충격",
      };
    case "경고":
      return {
        badgeClass: "bg-amber-100 text-amber-700 border border-amber-200",
        icon: "⚠️",
        label: "경고",
      };
    default:
      return {
        badgeClass: "bg-emerald-100 text-emerald-700 border border-emerald-200",
        icon: "🛡️",
        label: "안전",
      };
  }
};

const formatDeadline = (deadline: Date | null) => {
  if (!deadline) return "기한 없음";
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return "잘못된 날짜";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatEstimatedTime = (hours: number | null) => {
  if (hours === null || Number.isNaN(hours)) return "미입력";
  return `${hours}시간`;
};

const formatForInput = (date: Date | null) => {
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

export function TodoItemCard({
  todo,
  priority,
  deleteTodo,
  selectedStyle,
  toggleTodoCompletion,
  notificationsEnabled,
  speechEnabled,
  onSpeak,
  updateTodo,
}: TodoItemCardProps) {
  const priorityStyles = getPriorityStyles(priority);
  const [isConfirming, setIsConfirming] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [nagRefreshKey, setNagRefreshKey] = useState(0);
  const pendingSpeechKeyRef = useRef<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(() => ({
    name: todo.name ?? "",
    deadline: formatForInput(todo.deadline),
    estimatedTime: todo.estimatedTime != null ? String(todo.estimatedTime) : "",
  }));
  const [remainingText, setRemainingText] = useState(() => {
    if (!todo.deadline) return "기한 없음";
    const diff = todo.deadline.getTime() - Date.now();
    return diff <= 0
      ? `마감 지남 (${formatDuration(Math.abs(diff))} 지각)`
      : formatDuration(diff);
  });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSkippedInitialEventRef = useRef(false);
  const prevStyleRef = useRef<NagStyle>(selectedStyle);
  const prevPriorityRef = useRef<PriorityRank>(
    calculateLocalPriority(todo.deadline ?? null, todo.estimatedTime ?? null),
  );
  const initialPriorityRef = useRef<PriorityRank>(priority);
  const prevRemainingRef = useRef<number | null>(
    todo.deadline ? todo.deadline.getTime() - Date.now() : null,
  );
  const triggeredThresholdsRef = useRef<Set<string>>(new Set());
  const lastSpeechKeyRef = useRef(-1);
  const lastLoadedKeyRef = useRef<number | null>(null);

  const nagPayload = {
    title: todo.name || "이름 없는 할 일",
    dueDate: todo.deadline
      ? new Date(todo.deadline)
      : new Date(Date.now() + 60 * 60 * 1000),
    estimatedTime: todo.estimatedTime ?? 1,
    createdAt: todo.createdAt ? new Date(todo.createdAt) : new Date(),
  };

  const isCompleted = Boolean(todo.completedAt);
  const rule = determineNagRule(nagPayload, new Date());
  const isCriticalPriority = toCanonicalPriority(priority) === "충격";
  const [shouldShowNag, setShouldShowNag] = useState(
    () => !isCompleted && toCanonicalPriority(priority) !== "안전",
  );
  const displayMessage = shouldShowNag ? aiMessage : null;

  const requestNagRefresh = useCallback((forcePlay = false) => {
    setNagRefreshKey((value) => {
      const next = value + 1;
      if (!forcePlay) {
        pendingSpeechKeyRef.current = next;
      }
      return next;
    });
  }, []);

  const triggerNotification = (message: string) => {
    if (
      !notificationsEnabled ||
      typeof window === "undefined" ||
      !("Notification" in window)
    )
      return;
    if (Notification.permission !== "granted") return;

    const title = todo.name || "PlanShock 알림";
    new Notification(title, { body: message });
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const needsFetch = shouldShowNag || pendingSpeechKeyRef.current !== null;
    if (!needsFetch) {
      setAiMessage(null);
      setAiError(null);
      setIsLoadingMessage(false);
      return () => controller.abort();
    }

    setIsLoadingMessage(true);
    setAiMessage(null);
    setAiError(null);

    fetchAiNagMessage(nagPayload, selectedStyle, controller.signal)
      .then((message) => {
        if (!cancelled) {
          setAiMessage(message);
          setIsLoadingMessage(false);
          if (pendingSpeechKeyRef.current !== null) {
            lastLoadedKeyRef.current = pendingSpeechKeyRef.current;
          } else {
            lastLoadedKeyRef.current = nagRefreshKey;
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("AI 잔소리 생성 실패:", error);
          setAiError(
            error instanceof Error ? error.message : "알 수 없는 오류",
          );
          setIsLoadingMessage(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [todo.id, selectedStyle, rule, shouldShowNag, isCompleted, nagRefreshKey]);

  useEffect(() => {
    if (!shouldShowNag || !displayMessage || isCompleted) return;

    const styleJustChanged = prevStyleRef.current !== selectedStyle;
    prevStyleRef.current = selectedStyle;

    if (styleJustChanged) {
      lastSpeechKeyRef.current = nagRefreshKey;
      pendingSpeechKeyRef.current = null;
      return;
    }

    if (
      pendingSpeechKeyRef.current !== null &&
      pendingSpeechKeyRef.current === nagRefreshKey &&
      lastLoadedKeyRef.current === nagRefreshKey &&
      lastSpeechKeyRef.current !== nagRefreshKey
    ) {
      if (!hasSkippedInitialEventRef.current) {
        const createdAtMs = todo.createdAt ? todo.createdAt.getTime() : null;
        const withinWindow =
          createdAtMs &&
          Date.now() - createdAtMs < INITIAL_EVENT_SKIP_WINDOW_MS;
        const shouldSkipInitial =
          withinWindow &&
          initialPriorityRef.current !== toLegacyPriority("안전");
        if (shouldSkipInitial) {
          hasSkippedInitialEventRef.current = true;
          lastSpeechKeyRef.current = nagRefreshKey;
          pendingSpeechKeyRef.current = null;
          return;
        }
        hasSkippedInitialEventRef.current = true;
      }

      if (notificationsEnabled) {
        triggerNotification(displayMessage);
      }
      if (speechEnabled && shouldShowNag) {
        onSpeak(displayMessage, selectedStyle).catch((error) =>
          console.error("TTS 재생 실패:", error),
        );
      }
      lastSpeechKeyRef.current = nagRefreshKey;
      pendingSpeechKeyRef.current = null;
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
  ]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    hasSkippedInitialEventRef.current = false;
    const initialPriority = calculateLocalPriority(
      todo.deadline ?? null,
      todo.estimatedTime ?? null,
    );
    prevPriorityRef.current = initialPriority;
    setShouldShowNag(
      !isCompleted && toCanonicalPriority(initialPriority) !== "안전",
    );
    prevRemainingRef.current = todo.deadline
      ? todo.deadline.getTime() - Date.now()
      : null;
    triggeredThresholdsRef.current.clear();
    lastSpeechKeyRef.current = -1;
    initialPriorityRef.current = initialPriority;
    setEditForm({
      name: todo.name ?? "",
      deadline: formatForInput(todo.deadline),
      estimatedTime:
        todo.estimatedTime != null ? String(todo.estimatedTime) : "",
    });
    setEditError(null);
    setIsEditing(false);
  }, [
    todo.id,
    todo.deadline ? todo.deadline.getTime() : null,
    todo.estimatedTime,
    isCompleted,
  ]);

  const handleDeleteClick = () => {
    if (!isConfirming) {
      console.warn(
        "정말로 이 할 일을 삭제하시겠습니까? 2초 안에 다시 누르면 삭제됩니다.",
      );
      setIsConfirming(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setIsConfirming(false);
        resetTimerRef.current = null;
      }, 2000);
      return;
    }

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    deleteTodo(todo.id);
    setIsConfirming(false);
  };

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = editForm.name.trim();
    if (!trimmedName) {
      setEditError("할 일 이름을 입력해주세요.");
      return;
    }

    const parsedDeadline = editForm.deadline
      ? new Date(editForm.deadline)
      : null;
    if (parsedDeadline && Number.isNaN(parsedDeadline.getTime())) {
      setEditError("올바른 마감 시간을 입력해주세요.");
      return;
    }

    const parsedEstimated =
      editForm.estimatedTime.trim().length > 0
        ? Number(editForm.estimatedTime)
        : null;
    if (
      parsedEstimated != null &&
      (Number.isNaN(parsedEstimated) || parsedEstimated < 0)
    ) {
      setEditError("예상 시간은 0 이상으로 입력해주세요.");
      return;
    }

    setEditError(null);
    setIsUpdating(true);
    try {
      await updateTodo(todo.id, {
        name: trimmedName,
        deadline: parsedDeadline,
        estimatedTime: parsedEstimated,
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update todo.", error);
      setEditError("할 일을 수정하는 중 문제가 발생했습니다.");
    } finally {
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    if (!todo.deadline) {
      setRemainingText("기한 없음");
      prevRemainingRef.current = null;
      return;
    }

    const triggerNagEvent = () => {
      requestNagRefresh();
      return true;
    };

    const evaluateSchedule = (diff: number) => {
      if (isCompleted) {
        prevRemainingRef.current = diff;
        triggeredThresholdsRef.current.clear();
        return;
      }

      const livePriority = calculateLocalPriority(
        todo.deadline,
        todo.estimatedTime ?? null,
      );
      const prevPriority = prevPriorityRef.current;
      let eventTriggered = false;

      if (
        toCanonicalPriority(prevPriority) !== toCanonicalPriority(livePriority)
      ) {
        if (
          toCanonicalPriority(prevPriority) === "안전" &&
          toCanonicalPriority(livePriority) === "경고"
        ) {
          eventTriggered = triggerNagEvent() || eventTriggered;
        } else if (
          toCanonicalPriority(prevPriority) !== "충격" &&
          toCanonicalPriority(livePriority) === "충격"
        ) {
          eventTriggered = triggerNagEvent() || eventTriggered;
        }
        setShouldShowNag(
          !isCompleted && toCanonicalPriority(livePriority) !== "안전",
        );
        if (toCanonicalPriority(livePriority) !== "충격") {
          triggeredThresholdsRef.current.clear();
        }
        prevPriorityRef.current = livePriority;
      }

      if (toCanonicalPriority(livePriority) !== "충격") {
        prevRemainingRef.current = diff;
        return;
      }

      if (!eventTriggered && toCanonicalPriority(livePriority) === "충격") {
        const prevDiff = prevRemainingRef.current;
        if (diff >= 0) {
          for (const threshold of PRE_DEADLINE_THRESHOLDS_ASC) {
            const prevAbove = prevDiff == null ? true : prevDiff > threshold.ms;
            if (
              prevAbove &&
              diff <= threshold.ms &&
              !triggeredThresholdsRef.current.has(threshold.key)
            ) {
              triggeredThresholdsRef.current.add(threshold.key);
              eventTriggered = triggerNagEvent() || eventTriggered;
              break;
            }
          }
          const prevPositive = prevDiff == null ? true : prevDiff > 0;
          if (
            prevPositive &&
            diff <= 0 &&
            !triggeredThresholdsRef.current.has("deadline-hit")
          ) {
            triggeredThresholdsRef.current.add("deadline-hit");
            eventTriggered = triggerNagEvent() || eventTriggered;
          }
        } else {
          const prevElapsed = prevDiff == null ? 0 : Math.max(0, -prevDiff);
          const elapsed = Math.abs(diff);
          for (const threshold of POST_DEADLINE_THRESHOLDS_ASC) {
            const prevBelow = prevElapsed < threshold.ms;
            if (
              prevBelow &&
              elapsed >= threshold.ms &&
              !triggeredThresholdsRef.current.has(threshold.key)
            ) {
              triggeredThresholdsRef.current.add(threshold.key);
              eventTriggered = triggerNagEvent() || eventTriggered;
              break;
            }
          }
        }
      }

      prevRemainingRef.current = diff;
    };

    const calc = () => {
      const diff = todo.deadline!.getTime() - Date.now();
      setRemainingText(
        diff <= 0
          ? `마감 지남 (${formatDuration(Math.abs(diff))} 지각)`
          : formatDuration(diff),
      );
      evaluateSchedule(diff);
    };

    calc();
    const interval = setInterval(calc, 60 * 1000);
    return () => clearInterval(interval);
  }, [
    todo.deadline ? todo.deadline.getTime() : null,
    todo.estimatedTime,
    isCompleted,
    requestNagRefresh,
  ]);

  return (
    <article
      className={`mx-auto flex max-w-xl flex-col gap-4 rounded-3xl border p-5 shadow-lg shadow-slate-200 transition ${
        isCompleted
          ? "bg-slate-100 border-slate-200 text-slate-500 line-through"
          : `hover:-translate-y-0.5 hover:shadow-xl ${
              isCriticalPriority
                ? "bg-red-500/10 border-red-200"
                : "bg-white/80 border-slate-200"
            }`
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-slate-900">
              {todo.name || "제목 없음"}
            </h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide                 
  ${priorityStyles.badgeClass}`}
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
                      ? "AI가 잔소리를 준비 중..."
                      : null)}
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                여유 있을 때 방심하면 다시 충격 상태로 떨어집니다.
              </p>
            )}
          </div>
          <p className="text-sm text-slate-500">남은 시간: {remainingText}</p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-[220px] md:flex-col md:items-stretch">
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
              checked={isCompleted}
              onChange={(event) =>
                toggleTodoCompletion(todo.id, event.target.checked)
              }
            />
            완료
          </label>
          <button
            type="button"
            onClick={() => {
              setIsUpdating(false);
              setEditError(null);
              setIsEditing((prev) => {
                const next = !prev;
                if (next) {
                  setEditForm({
                    name: todo.name ?? "",
                    deadline: formatForInput(todo.deadline),
                    estimatedTime:
                      todo.estimatedTime != null
                        ? String(todo.estimatedTime)
                        : "",
                  });
                }
                return next;
              });
            }}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
          >
            {isEditing ? "수정 취소" : "수정"}
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            className="inline-flex items-center justify-center rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-600 transition hover:bg-red-100"
          >
            {isConfirming ? "정말로 삭제?" : "삭제"}
          </button>
        </div>
      </div>
      {isEditing && (
        <form
          onSubmit={handleEditSubmit}
          className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                이름
              </span>
              <input
                name="edit-name"
                value={editForm.name}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none   
  focus:ring-2 focus:ring-emerald-100"
                placeholder="할 일 이름"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                마감
              </span>
              <input
                type="datetime-local"
                name="edit-deadline"
                value={editForm.deadline}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    deadline: event.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none   
  focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              예상 시간 (시간)
            </span>
            <input
              type="number"
              min="0"
              step="0.5"
              name="edit-estimatedTime"
              value={editForm.estimatedTime}
              onChange={(event) =>
                setEditForm((prev) => ({
                  ...prev,
                  estimatedTime: event.target.value,
                }))
              }
              placeholder="예: 4"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none     
  focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          {editError && (
            <p className="text-xs font-semibold text-red-500">{editError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isUpdating}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold uppercase       
  tracking-wide text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUpdating ? "저장 중..." : "변경 사항 저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setIsUpdating(false);
                setEditError(null);
                setEditForm({
                  name: todo.name ?? "",
                  deadline: formatForInput(todo.deadline),
                  estimatedTime:
                    todo.estimatedTime != null
                      ? String(todo.estimatedTime)
                      : "",
                });
              }}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold  
  uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
            >
              취소
            </button>
          </div>
        </form>
      )}
      <dl className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            예상 시간
          </dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">
            {formatEstimatedTime(todo.estimatedTime)}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            마감
          </dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">
            {formatDeadline(todo.deadline)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default TodoItemCard;
