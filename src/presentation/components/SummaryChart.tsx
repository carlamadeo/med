import type { MonthActivity } from '@domain/summary';

interface SummaryChartProps {
  data: MonthActivity[];
}

const WIDTH = 760;
const HEIGHT = 260;
const PAD = { top: 18, right: 16, bottom: 30, left: 38 };

interface Point {
  x: number;
  y: number;
  label: string;
  count: number;
}

function smoothPath(points: Point[]): string {
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

export function SummaryChart({ data }: SummaryChartProps) {
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const maxValue = Math.max(4, ...data.map((item) => item.count));
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const max = step * 4;
  const points: Point[] = data.map((item, index) => ({
    x: PAD.left + (plotWidth * index) / Math.max(data.length - 1, 1),
    y: PAD.top + plotHeight - (plotHeight * item.count) / max,
    label: item.label,
    count: item.count,
  }));

  const line = smoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  const area = first && last
    ? `${line} L ${last.x} ${PAD.top + plotHeight} L ${first.x} ${PAD.top + plotHeight} Z`
    : '';
  const description = data.map((item) => `${item.label}: ${item.count}`).join(', ');

  return (
    <svg
      className="activity-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-labelledby="activity-chart-title activity-chart-desc"
    >
      <title id="activity-chart-title">Actividad del archivo</title>
      <desc id="activity-chart-desc">Estudios agregados por mes. {description}.</desc>
      <defs>
        <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 1, 2, 3, 4].map((index) => {
        const y = PAD.top + (plotHeight * index) / 4;
        return (
          <g key={index}>
            <line className="activity-grid" x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} />
            <text className="activity-axis" x={PAD.left - 8} y={y + 4} textAnchor="end">
              {Math.round(max - (max * index) / 4)}
            </text>
          </g>
        );
      })}

      {area && <path className="activity-area" d={area} />}
      {line && <path className="activity-line" d={line} />}

      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle className="activity-dot" cx={point.x} cy={point.y} r="3.5">
            <title>{`${point.label}: ${point.count} ${point.count === 1 ? 'estudio' : 'estudios'}`}</title>
          </circle>
          <text className="activity-axis activity-x" x={point.x} y={HEIGHT - 8} textAnchor="middle">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}