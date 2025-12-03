import { Pie } from "react-chartjs-2";
import { Chart, ArcElement, Tooltip, Legend } from "chart.js";
import type { TodoItem, PriorityRank } from "../App";

Chart.register(ArcElement, Tooltip, Legend);

type HabitChartsProps = {
  todos: TodoItem[];
};

const PRIORITY_ORDER: Array<"충격" | "경고" | "안전"> = [
  "충격",
  "경고",
  "안전",
];

const priorityMeta: Record<
  "충격" | "경고" | "안전",
  { label: string; className: string }
> = {
  충격: { label: "충격", className: "bg-red-100 text-red-700 border-red-200" },
  경고: {
    label: "경고",
    className: "bg-orange-100 text-orange-700 border-orange-200",
  },
  안전: {
    label: "안전",
    className: "bg-emerald-50 text-emerald-600 border-emerald-200",
  },
};

const canonicalPriority = (
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

const TIME_LABELS = [

  "아침 (5-12시)",

  "오후 (12-17시)",

  "저녁 (17-22시)",

  "밤 (22-05시)",

];



type TimeKey = "morning" | "afternoon" | "evening" | "night";



export function HabitCharts({ todos }: HabitChartsProps) {
  const completed = todos.filter((todo) => todo.completedAt);
  const priorityCounts: Record<"충격" | "경고" | "안전", number> = {
    충격: 0,
    경고: 0,
    안전: 0,
  };
  const timeCounts: Record<TimeKey, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };

  completed.forEach((todo) => {
    const priority = canonicalPriority(todo.priority);
    priorityCounts[priority] += 1;

    if (todo.completedAt) {
      const hour = todo.completedAt.getHours();
      if (hour >= 5 && hour < 12) timeCounts.morning += 1;
      else if (hour >= 12 && hour < 17) timeCounts.afternoon += 1;
      else if (hour >= 17 && hour < 22) timeCounts.evening += 1;
      else timeCounts.night += 1;
    }
  });

  const priorityData = {
    labels: PRIORITY_ORDER.map((key) => priorityMeta[key].label),
    datasets: [
      {
        data: PRIORITY_ORDER.map((key) => priorityCounts[key]),
        backgroundColor: ["#ef4444", "#f97316", "#22c55e"],
        borderWidth: 3,
        cutout: "60%",
      },
    ],
  };

  const timeData = {
    labels: TIME_LABELS,
    datasets: [
      {
        data: [
          timeCounts.morning,
          timeCounts.afternoon,
          timeCounts.evening,
          timeCounts.night,
        ],
        backgroundColor: ["#93c5fd", "#fdba74", "#f9a8d4", "#c4b5fd"],
        borderWidth: 3,
        cutout: "60%",
      },
    ],
  };

  const topPriority =
    PRIORITY_ORDER.find((key) => priorityCounts[key] > 0) ?? "안전";
  const topTime = (() => {
    const entries: Array<[string, number]> = [
      ["아침 (5-12시)", timeCounts.morning],
      ["오후 (12-17시)", timeCounts.afternoon],
      ["저녁 (17-22시)", timeCounts.evening],
      ["밤 (22-05시)", timeCounts.night],
    ];
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? top[0] : "데이터 없음";
  })();

  return (
    <div className="grid w-full gap-3 lg:grid-cols-2">
      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
          <span>우선순위 분포</span>
          <span>{completed.length}건</span>
        </div>
        <div className="relative flex min-h-[220px] items-center justify-center">
          <Pie
            data={priorityData}
            options={{
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 10 } },
              },
              maintainAspectRatio: false,
            }}
          />
          <div className="pointer-events-none absolute text-center">
            <p className="text-xs text-slate-500">가장 많은 상태</p>
            <p className="text-xl font-semibold text-slate-900">
              {priorityMeta[topPriority].label}
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
          <span>완료 시간대 분포</span>
          <span>
            {timeCounts.morning +
              timeCounts.afternoon +
              timeCounts.evening +
              timeCounts.night}
            건
          </span>
        </div>
        <div className="relative flex min-h-[220px] items-center justify-center">
          <Pie
            data={timeData}
            options={{
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 10 } },
              },
              maintainAspectRatio: false,
            }}
          />
          <div className="pointer-events-none absolute text-center">
            <p className="text-xs text-slate-500">가장 바쁜 시간대</p>
            <p className="text-xl font-semibold text-slate-900">{topTime}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HabitCharts;
