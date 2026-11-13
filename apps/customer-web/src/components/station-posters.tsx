/**
 * Áp phích ga cho ba điểm trên tuyến Pine Hill. Tranh MINH HOẠ vẽ tay bằng SVG theo lối áp phích du lịch nhà
 * ga (mảng màu phẳng, 4–6 mực, không viền), không chụp lại địa điểm cụ thể. Thay bằng ảnh/tranh thật khi có.
 * Chỉ là tranh: tên ga và thông tin nằm ở HTML bên cạnh, nên SVG ẩn với trình đọc màn hình.
 */
import type { ReactElement } from 'react';

const FRAME = { viewBox: '0 0 300 400', preserveAspectRatio: 'xMidYMid slice' } as const;

function Pine({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
      <path d="M0 -60 L14 -34 L8 -34 L22 -12 L13 -12 L28 12 L-28 12 L-13 -12 L-22 -12 L-8 -34 L-14 -34 Z" />
      <rect x="-2.5" y="12" width="5" height="10" />
    </g>
  );
}

export function DaLatPoster(): ReactElement {
  return (
    <svg {...FRAME} aria-hidden="true" focusable="false" className="ph-poster-art">
      <rect width="300" height="400" fill="#E9D9A6" />
      <circle cx="214" cy="92" r="38" fill="#F2B632" />
      <rect y="118" width="300" height="10" fill="#F6EFD9" opacity="0.8" />
      <rect y="136" width="300" height="6" fill="#F6EFD9" opacity="0.6" />
      <path d="M0 210 C60 160 110 170 160 150 C210 132 250 160 300 140 V400 H0 Z" fill="#8FA77A" />
      <path d="M0 250 C70 214 120 236 180 206 C230 182 270 206 300 196 V400 H0 Z" fill="#5E7F5B" />
      <Pine x={52} y={232} s={1.1} fill="#2F4A36" />
      <Pine x={86} y={240} s={0.8} fill="#2F4A36" />
      <Pine x={238} y={214} s={1.25} fill="#2F4A36" />
      <Pine x={270} y={226} s={0.9} fill="#2F4A36" />
      <path d="M0 292 C80 278 150 298 300 282 V400 H0 Z" fill="#3E6A7A" />
      <path
        d="M30 312 H130 M150 326 H270 M60 342 H170"
        stroke="#A9C7CF"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M0 360 C90 350 170 372 300 356 V400 H0 Z" fill="#2F4A36" />
      <Pine x={34} y={380} s={1.5} fill="#1E3326" />
      <Pine x={270} y={384} s={1.7} fill="#1E3326" />
      <rect y="186" width="300" height="12" fill="#F6EFD9" opacity="0.55" />
    </svg>
  );
}

export function PhanThietPoster(): ReactElement {
  return (
    <svg {...FRAME} aria-hidden="true" focusable="false" className="ph-poster-art">
      <rect width="300" height="400" fill="#F3C49A" />
      <circle cx="78" cy="96" r="44" fill="#F7E6C4" />
      <path d="M196 70 L232 54 L222 92 Z" fill="#B8341C" />
      <path d="M222 92 C210 130 236 150 220 190" stroke="#5A3A2E" strokeWidth="1.5" fill="none" />
      <path d="M0 178 H300 V214 H0 Z" fill="#2B5D8A" />
      <path d="M20 190 H90 M130 198 H230" stroke="#9CC2DC" strokeWidth="3" strokeLinecap="round" />
      <path d="M0 230 C70 196 140 214 196 200 C246 188 276 206 300 200 V400 H0 Z" fill="#E59A55" />
      <path d="M0 274 C90 236 170 270 300 236 V400 H0 Z" fill="#CE6A35" />
      <path d="M0 330 C80 300 200 330 300 300 V400 H0 Z" fill="#A9472A" />
      <path
        d="M60 300 C90 292 120 300 150 294"
        stroke="#F3C49A"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M150 350 C180 342 220 352 260 344"
        stroke="#F3C49A"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="248" cy="186" rx="12" ry="5" fill="#3B2A22" />
      <ellipse cx="200" cy="190" rx="9" ry="4" fill="#3B2A22" />
    </svg>
  );
}

export function VungTauPoster(): ReactElement {
  return (
    <svg {...FRAME} aria-hidden="true" focusable="false" className="ph-poster-art">
      <rect width="300" height="400" fill="#BFD9E2" />
      <circle cx="232" cy="70" r="26" fill="#F7EBD0" />
      <path d="M0 230 C40 170 90 130 150 126 C200 124 240 160 300 190 V400 H0 Z" fill="#4E7D4F" />
      <path d="M0 250 C60 210 110 196 170 204 C220 210 260 232 300 240 V400 H0 Z" fill="#355F3C" />
      <rect x="138" y="70" width="18" height="60" fill="#F7F3EA" />
      <rect x="135" y="62" width="24" height="10" fill="#B8341C" />
      <path d="M134 62 L147 46 L160 62 Z" fill="#1A1716" />
      <rect x="143" y="84" width="8" height="10" fill="#1B3A82" />
      <path d="M0 270 H300 V400 H0 Z" fill="#1B5E86" />
      <path
        d="M20 292 q12 -8 24 0 t24 0 M150 306 q12 -8 24 0 t24 0 t24 0 M60 334 q12 -8 24 0 t24 0 M200 352 q12 -8 24 0 t24 0"
        stroke="#9CC9DE"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M70 262 L104 262 L98 272 L76 272 Z" fill="#F7F3EA" />
      <path
        d="M88 236 V262 M88 238 L104 256 L88 256 Z"
        stroke="#F7F3EA"
        strokeWidth="2"
        fill="#F7F3EA"
      />
      <path d="M0 372 H300 V400 H0 Z" fill="#0F3E5A" />
    </svg>
  );
}

export const POSTERS: Readonly<Record<string, () => ReactElement>> = {
  DL: DaLatPoster,
  PT: PhanThietPoster,
  VT: VungTauPoster,
};
