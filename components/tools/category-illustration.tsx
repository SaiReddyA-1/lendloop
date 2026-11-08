import { useId, type ReactNode } from "react";
import type { CategoryValue } from "@/lib/categories";
import { cn } from "@/lib/utils";

// Brand palette (onefinops): brand #F1643F, gradient #F49267 > #E2653F > #C0512C, surface #F5F4F0, ink #16181C.
const INK = "#16181C";
const SURFACE = "#F5F4F0";
const BRAND = "#F1643F";
const LIGHT = "#F49267";
const MID = "#E2653F";
const DEEP = "#C0512C";
const SW = 6; // one stroke width for every silhouette

type Ids = { grad: string; soft: string };

/** Shared canvas: warm surface, soft brand blobs, a ground shadow. Objects are drawn on top (viewBox 400x300). */
function Frame({ children, ids, shadowY = 252 }: { children: (ids: Ids) => ReactNode; ids: Ids; shadowY?: number }) {
  return (
    <>
      <defs>
        <linearGradient id={ids.grad} gradientUnits="userSpaceOnUse" x1="70" y1="50" x2="330" y2="260">
          <stop offset="0" stopColor={LIGHT} />
          <stop offset="0.55" stopColor={MID} />
          <stop offset="1" stopColor={DEEP} />
        </linearGradient>
        <linearGradient id={ids.soft} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={LIGHT} stopOpacity="0.55" />
          <stop offset="1" stopColor={DEEP} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill={SURFACE} />
      <circle cx="200" cy="146" r="112" fill={`url(#${ids.soft})`} opacity="0.4" />
      <circle cx="328" cy="62" r="30" fill={`url(#${ids.soft})`} opacity="0.55" />
      <circle cx="64" cy="228" r="20" fill={`url(#${ids.soft})`} opacity="0.5" />
      <circle cx="92" cy="70" r="7" fill={BRAND} opacity="0.35" />
      <circle cx="352" cy="214" r="5" fill={BRAND} opacity="0.35" />
      <ellipse cx="200" cy={shadowY} rx="96" ry="9" fill={INK} opacity="0.09" />
      {children(ids)}
    </>
  );
}

const stroke = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round", strokeLinecap: "round" } as const;

function PowerTools({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* bit and chuck */}
      <path d="M70 128 L112 124 L112 132 Z" fill={INK} />
      <rect x="108" y="108" width="34" height="40" rx="8" fill="#FFFFFF" />
      <path d="M120 108 V148 M130 108 V148" strokeWidth="3" />
      {/* motor body */}
      <path d="M140 100 H250 a30 30 0 0 1 30 30 v4 a24 24 0 0 1 -24 24 H140 a14 14 0 0 1 -14 -14 v-30 a14 14 0 0 1 14 -14 Z" fill={`url(#${grad})`} />
      <path d="M156 112 H214" stroke="#FFFFFF" strokeWidth="5" opacity="0.55" />
      <circle cx="252" cy="128" r="6" fill="#FFFFFF" strokeWidth="4" />
      {/* handle */}
      <path d="M196 156 H246 L262 222 a10 10 0 0 1 -10 12 H222 a10 10 0 0 1 -10 -8 Z" fill={DEEP} />
      <path d="M222 188 L254 188 M224 204 L258 204" stroke="#FFFFFF" strokeWidth="4" opacity="0.5" />
      {/* trigger */}
      <path d="M190 160 h14 v26 h-8 a6 6 0 0 1 -6 -6 Z" fill={INK} />
      {/* battery */}
      <rect x="196" y="230" width="84" height="24" rx="8" fill={INK} />
      <rect x="208" y="238" width="22" height="8" rx="4" fill={LIGHT} stroke="none" />
    </g>
  );
}

function HandTools({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* hammer, leaning right */}
      <g transform="rotate(32 200 150)">
        <rect x="190" y="112" width="20" height="132" rx="10" fill={DEEP} />
        <path d="M193 190 H207 M193 206 H207 M193 222 H207" stroke="#FFFFFF" strokeWidth="3" opacity="0.5" />
        <path d="M150 74 H236 a12 12 0 0 1 12 12 v18 a12 12 0 0 1 -12 12 H196 L176 128 L172 116 H150 a12 12 0 0 1 -12 -12 V86 a12 12 0 0 1 12 -12 Z" fill={INK} />
        <path d="M156 84 H228" stroke="#FFFFFF" strokeWidth="4" opacity="0.35" />
      </g>
      {/* open-end wrench, leaning left */}
      <g transform="rotate(-32 200 150)">
        <path d="M184 92 H216 L220 232 a20 20 0 0 1 -40 0 Z" fill={`url(#${grad})`} />
        <path d="M190 31.5 V60 a10 10 0 0 0 20 0 V31.5 A34 34 0 1 1 190 31.5 Z" fill={`url(#${grad})`} />
        <circle cx="200" cy="228" r="8" fill={SURFACE} />
        <path d="M200 112 V196" stroke="#FFFFFF" strokeWidth="4" opacity="0.45" fill="none" />
      </g>
    </g>
  );
}

function Garden({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* soil mound */}
      <path d="M96 252 Q150 218 204 236 Q260 214 312 252 Z" fill={INK} stroke="none" opacity="0.88" />
      {/* leaf pair */}
      <path d="M200 232 V168" fill="none" />
      <path d="M200 176 C150 176 122 140 126 100 C170 98 200 128 200 176 Z" fill={`url(#${grad})`} />
      <path d="M200 176 C176 156 160 134 144 114" fill="none" stroke="#FFFFFF" strokeWidth="4" opacity="0.6" />
      <path d="M200 192 C252 192 282 154 276 112 C228 110 198 144 200 192 Z" fill={LIGHT} />
      <path d="M200 192 C226 170 246 150 262 126" fill="none" stroke="#FFFFFF" strokeWidth="4" opacity="0.6" />
      {/* trowel, planted in the soil */}
      <g transform="rotate(24 300 214)">
        <path d="M300 152 C276 152 270 188 300 232 C330 188 324 152 300 152 Z" fill="#FFFFFF" />
        <path d="M300 160 V218" strokeWidth="3" fill="none" />
        <rect x="294" y="88" width="12" height="42" rx="6" fill={DEEP} />
        <path d="M300 128 V154" fill="none" />
      </g>
    </g>
  );
}

function Kitchen({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* whisk behind the pot */}
      <g transform="rotate(18 296 150)">
        <rect x="290" y="204" width="12" height="46" rx="6" fill={DEEP} />
        <path d="M296 204 C256 190 262 108 296 92 C330 108 336 190 296 204 Z" fill="none" />
        <path d="M296 204 C278 186 280 120 296 92 C312 120 314 186 296 204 Z" fill="none" />
        <path d="M296 204 V92" fill="none" strokeWidth="4" />
      </g>
      {/* steam */}
      <path d="M170 84 q-10 -12 0 -24 t0 -22 M202 80 q-10 -12 0 -24 t0 -22" fill="none" stroke={MID} strokeWidth="5" opacity="0.7" />
      {/* lid */}
      <path d="M126 140 C128 110 156 98 186 98 C216 98 244 110 246 140 Z" fill={LIGHT} />
      <circle cx="186" cy="94" r="9" fill={INK} />
      {/* pot */}
      <rect x="118" y="140" width="136" height="88" rx="16" fill={`url(#${grad})`} />
      <path d="M134 164 H178" stroke="#FFFFFF" strokeWidth="5" opacity="0.5" />
      <rect x="86" y="160" width="36" height="14" rx="7" fill={INK} />
      <rect x="250" y="160" width="36" height="14" rx="7" fill={INK} />
    </g>
  );
}

function Camping({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* pine trees */}
      <path d="M100 232 V214 M100 160 L74 214 H126 Z" fill={DEEP} />
      <path d="M326 236 V218 M326 170 L302 218 H350 Z" fill={LIGHT} />
      {/* tent */}
      <path d="M196 60 L306 240 H86 Z" fill={`url(#${grad})`} />
      <path d="M196 132 L238 240 H154 Z" fill={INK} />
      <path d="M196 132 V240" strokeWidth="4" stroke={SURFACE} opacity="0.55" fill="none" />
      <path d="M196 60 V40 L220 48 L196 56" fill={BRAND} strokeWidth="4" />
      <path d="M72 240 H330" fill="none" />
    </g>
  );
}

function Cleaning({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* bucket */}
      <path d="M196 148 C196 96 296 96 296 148" fill="none" />
      <path d="M180 148 H312 L296 244 a12 12 0 0 1 -12 10 H208 a12 12 0 0 1 -12 -10 Z" fill={`url(#${grad})`} />
      <path d="M200 176 H292" stroke="#FFFFFF" strokeWidth="5" opacity="0.5" />
      {/* spray bottle */}
      <rect x="92" y="156" width="76" height="98" rx="18" fill="#FFFFFF" />
      <path d="M106 200 H154 V234 a8 8 0 0 1 -8 8 H114 a8 8 0 0 1 -8 -8 Z" fill={LIGHT} strokeWidth="4" />
      <rect x="114" y="134" width="32" height="24" rx="6" fill={INK} />
      <path d="M106 134 V108 a6 6 0 0 1 6 -6 H166 a12 12 0 0 1 12 12 V126 H150 V134 Z" fill={DEEP} />
      <path d="M178 112 H192" fill="none" strokeWidth="5" />
      <path d="M146 160 q18 4 22 24" fill="none" strokeWidth="5" />
      {/* bubbles */}
      <circle cx="226" cy="84" r="12" fill="none" strokeWidth="4" stroke={MID} />
      <circle cx="262" cy="64" r="7" fill="none" strokeWidth="4" stroke={MID} />
      <circle cx="250" cy="100" r="5" fill={LIGHT} stroke="none" />
    </g>
  );
}

function Other({ grad }: Ids) {
  return (
    <g {...stroke}>
      {/* box: left face, right face, lid */}
      <path d="M200 112 L292 150 V232 L200 270 Z" fill={DEEP} transform="translate(0 -22)" />
      <path d="M200 112 L108 150 V232 L200 270 Z" fill={LIGHT} transform="translate(0 -22)" />
      <path d="M200 52 L292 90 L200 128 L108 90 Z" fill={`url(#${grad})`} />
      {/* tape */}
      <path d="M154 71 L246 109 L200 128 L108 90 Z" fill="#FFFFFF" opacity="0.55" stroke="none" />
      <path d="M200 128 V248" fill="none" strokeWidth="4" />
      <path d="M232 138 L262 150" fill="none" stroke="#FFFFFF" strokeWidth="5" opacity="0.6" />
    </g>
  );
}

const ART: Record<CategoryValue, (ids: Ids) => ReactNode> = {
  power_tools: (i) => <PowerTools {...i} />,
  hand_tools: (i) => <HandTools {...i} />,
  garden: (i) => <Garden {...i} />,
  kitchen: (i) => <Kitchen {...i} />,
  camping: (i) => <Camping {...i} />,
  cleaning: (i) => <Cleaning {...i} />,
  other: (i) => <Other {...i} />,
};

/**
 * Decorative category illustration used when a tool has no photo. Fills its parent (give the parent a fixed
 * aspect ratio). aria-hidden: the card text already names the tool and its category.
 */
export function CategoryIllustration({ category, className }: { category: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const ids: Ids = { grad: `ci-g-${uid}`, soft: `ci-s-${uid}` };
  const art = ART[category as CategoryValue] ?? ART.other;
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={cn("block size-full", className)}
    >
      <Frame ids={ids}>
        {art}
      </Frame>
    </svg>
  );
}
