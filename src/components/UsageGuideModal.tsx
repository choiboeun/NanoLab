import type { ReactNode } from "react";

type UsageGuideModalProps = {
  open: boolean;
  onClose: () => void;
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="space-y-1 rounded-2xl border border-slate-200 bg-white/80 p-4">
    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    <div className="text-xs leading-relaxed text-slate-600">{children}</div>
  </section>
);

export function UsageGuideModal({ open, onClose }: UsageGuideModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-10">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate- 
  900/20"
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
              PLANSHOCK GUIDE
            </p>
            <h2 className="text-2xl font-bold text-slate-900">사용 가이드</h2>
            <p className="mt-1 text-sm text-slate-500">
              PlanShock의 잔소리 기준과 주요 기능을 한눈에 확인하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            닫기
          </button>
        </header>

        <div className="space-y-4 text-sm text-slate-600">
          <Section title="알림 · 음성 트리거 기준">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                우선순위 전환: <strong>안전 → 경고</strong>,{" "}
                <strong>경고 → 충격</strong> 순간 즉시 텍스트·음성 갱신
              </li>
              <li>
                충격 상태: 마감까지 <strong>5h, 4h, 3h, 2h, 1h, 30m</strong>{" "}
                지점에서 한 번씩 알림
              </li>
              <li>
                마감 시점: <strong>0h</strong>에서 “마감됨” 알림, 이후{" "}
                <strong>+1h, +6h, +24h</strong>에서도 한 번씩
              </li>
              <li>
                브라우저 알림 전용: 마감 30분 전에 한 번 더 노티(음성 없음)
              </li>
              <li>
                예상 시간을 입력하면 위 기준에 따라 더욱 정확하게 충격/경고가
                판정됩니다.
              </li>
            </ul>
          </Section>

          <Section title="할 일 추가 및 수정">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                좌측 PlanShock Todo 입력폼에서 이름·마감·예상 시간을 입력해 새
                작업을 등록합니다.
              </li>
              <li>
                진행중 카드에서 <strong>수정</strong> 버튼을 누르면
                이름/마감/예상 시간을 바로 편집할 수 있습니다.
              </li>
              <li>
                마감이 지난 작업은 “마감 지남 (X시간 지각)” 형식으로 경과 시간이
                함께 표시됩니다.
              </li>
            </ul>
          </Section>

          <Section title="잔소리 · 음성 옵션">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                사이드바에서 원하는 잔소리 스타일을 선택하면 모든 카드의 톤이
                바뀝니다.
              </li>
              <li>
                브라우저 알림/TTS 토글로 텍스트·음성 알림을 각각 켜고 끌 수
                있습니다.
              </li>
              <li>
                스타일을 바꾸면 텍스트와 음성 메시지가 즉시 재생성되며 충격/경고
                상태에서 자동 재생됩니다.
              </li>
            </ul>
          </Section>

          <Section title="분석 · 인사이트">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                좌측 상단 “가장 긴급한 작업” 카드에서 마감이 임박한 일을 빠르게
                파악할 수 있습니다.
              </li>
              <li>
                상단 스트레스 레이더와 아래 대시보드에서 현재 충격/경고 비율과
                진행 상황을 확인하세요.
              </li>
              <li>
                오른쪽 패널에는 주간 AI 요약과 완료 시간대/우선순위 차트가
                정리되어 있습니다.
              </li>
            </ul>
          </Section>

          <Section title="기본 사용 흐름">
            <ol className="list-decimal space-y-1 pl-5">
              <li>할 일을 등록하고 예상 시간을 입력합니다.</li>
              <li>대시보드와 긴급 카드에서 오늘 집중할 작업을 선택합니다.</li>
              <li>
                우선순위가 올라가거나 마감이 가까워지면 잔소리/알림으로 즉시
                대응합니다.
              </li>
              <li>
                완료 체크 후 필요하면 수정/삭제하여 일정 관리를 이어갑니다.
              </li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default UsageGuideModal;
