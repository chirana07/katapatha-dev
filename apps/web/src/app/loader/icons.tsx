/**
 * The loader workspace's icons, from the Figma file (L-01…L-08).
 *
 * Generated from the exported Figma vectors, not drawn by hand: the paths are
 * the design's own. Stroke and fill are `currentColor`, so a text colour
 * class tints them; a filled glyph's cutout (the tick inside a filled circle)
 * uses `--icon-cutout`, white by default.
 *
 * Decorative by default (aria-hidden). Size with a `size-*` class.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(viewBox: string, props: IconProps) {
  return { viewBox, fill: "none", "aria-hidden": true, focusable: false, className: "size-5 shrink-0", ...props } as const;
}

export function TruckIcon(props: IconProps) {
  return (
    <svg {...base("0 0 26 26", props)}>
      <path d="M15.1667 19.5V6.5C15.1667 5.92536 14.9384 5.37426 14.5321 4.96793C14.1257 4.56161 13.5746 4.33333 13 4.33333H4.33333C3.7587 4.33333 3.2076 4.56161 2.80127 4.96793C2.39494 5.37426 2.16667 5.92536 2.16667 6.5V18.4167C2.16667 18.704 2.2808 18.9795 2.48397 19.1827C2.68713 19.3859 2.96268 19.5 3.25 19.5H5.41667" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.25 19.5H9.75" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.5833 19.5H22.75C23.0373 19.5 23.3129 19.3859 23.516 19.1827C23.7192 18.9795 23.8333 18.704 23.8333 18.4167V14.4625C23.8329 14.2167 23.7488 13.9783 23.595 13.7865L19.825 9.074C19.7237 8.94712 19.5951 8.84464 19.4489 8.77413C19.3026 8.70362 19.1424 8.6669 18.98 8.66667H15.1667" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.4167 21.6667C19.6133 21.6667 20.5833 20.6966 20.5833 19.5C20.5833 18.3034 19.6133 17.3333 18.4167 17.3333C17.22 17.3333 16.25 18.3034 16.25 19.5C16.25 20.6966 17.22 21.6667 18.4167 21.6667Z" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.58333 21.6667C8.77995 21.6667 9.75 20.6966 9.75 19.5C9.75 18.3034 8.77995 17.3333 7.58333 17.3333C6.38672 17.3333 5.41667 18.3034 5.41667 19.5C5.41667 20.6966 6.38672 21.6667 7.58333 21.6667Z" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <svg {...base("0 0 21 21", props)}>
      <path d="M9.625 19.0138C9.89103 19.1673 10.1928 19.2482 10.5 19.2482C10.8072 19.2482 11.109 19.1673 11.375 19.0138L17.5 15.5138C17.7658 15.3603 17.9865 15.1397 18.1401 14.874C18.2937 14.6083 18.3747 14.3069 18.375 14V7C18.3747 6.69312 18.2937 6.39171 18.1401 6.12602C17.9865 5.86033 17.7658 5.63969 17.5 5.48625L11.375 1.98625C11.109 1.83266 10.8072 1.75179 10.5 1.75179C10.1928 1.75179 9.89103 1.83266 9.625 1.98625L3.5 5.48625C3.23423 5.63969 3.01348 5.86033 2.8599 6.12602C2.70632 6.39171 2.62531 6.69312 2.625 7V14C2.62531 14.3069 2.70632 14.6083 2.8599 14.874C3.01348 15.1397 3.23423 15.3603 3.5 15.5138L9.625 19.0138Z" stroke="currentColor" strokeWidth="1.8375" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 19.25V10.5M10.5 10.5L2.87875 6.125M10.5 10.5L18.1212 6.125M6.5625 3.73625L14.4375 8.2425" stroke="currentColor" strokeWidth="1.8375" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoxCheckIcon(props: IconProps) {
  return (
    <svg {...base("0 0 26 26", props)}>
      <path d="M17.3333 17.3333L19.5 19.5L23.8333 15.1667" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.75 10.8333V8.66667C22.7496 8.28671 22.6493 7.91354 22.4592 7.58459C22.269 7.25564 21.9957 6.98248 21.6667 6.7925L14.0833 2.45917C13.754 2.269 13.3803 2.16889 13 2.16889C12.6197 2.16889 12.246 2.269 11.9167 2.45917L4.33333 6.7925C4.00428 6.98248 3.73098 7.25564 3.54083 7.58459C3.35069 7.91354 3.25039 8.28671 3.25 8.66667V17.3333C3.25039 17.7133 3.35069 18.0865 3.54083 18.4154C3.73098 18.7444 4.00428 19.0175 4.33333 19.2075L11.9167 23.5408C12.246 23.731 12.6197 23.8311 13 23.8311C13.3803 23.8311 13.754 23.731 14.0833 23.5408L16.25 22.3058" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.56417 7.58333L13 13M13 13L22.4358 7.58333M13 13V23.8333" stroke="currentColor" strokeWidth="2.16667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckCircleFilledIcon(props: IconProps) {
  return (
    <svg {...base("0 0 46 46", props)}>
      <path d="M23 44.0833C34.644 44.0833 44.0833 34.644 44.0833 23C44.0833 11.356 34.644 1.91667 23 1.91667C11.356 1.91667 1.91667 11.356 1.91667 23C1.91667 34.644 11.356 44.0833 23 44.0833Z" fill="currentColor" />
      <path d="M13.4167 23.575L19.55 29.7083L32.5833 16.675" stroke="var(--icon-cutout, white)" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base("0 0 20 20", props)}>
      <path d="M10 18.3333C14.6024 18.3333 18.3333 14.6024 18.3333 10C18.3333 5.39763 14.6024 1.66667 10 1.66667C5.39763 1.66667 1.66667 5.39763 1.66667 10C1.66667 14.6024 5.39763 18.3333 10 18.3333Z" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 5V10L13.3333 11.6667" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M14.25 3H3.75C2.92157 3 2.25 3.67157 2.25 4.5V15C2.25 15.8284 2.92157 16.5 3.75 16.5H14.25C15.0784 16.5 15.75 15.8284 15.75 15V4.5C15.75 3.67157 15.0784 3 14.25 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 1.5V4.5M6 1.5V4.5M2.25 7.5H15.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M8.25 14.25C11.5637 14.25 14.25 11.5637 14.25 8.25C14.25 4.93629 11.5637 2.25 8.25 2.25C4.93629 2.25 2.25 4.93629 2.25 8.25C2.25 11.5637 4.93629 14.25 8.25 14.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.75 15.75L12.525 12.525" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...base("0 0 17 17", props)}>
      <path d="M15.5833 2.125H1.41667L7.08333 8.82583V13.4583L9.91667 14.875V8.82583L15.5833 2.125Z" stroke="currentColor" strokeWidth="1.41667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base("0 0 14 17", props)}>
      <path d="M7 16.0833C7 16.0833 12.8333 11.125 12.8333 6.75C12.8333 5.2029 12.2188 3.71917 11.1248 2.62521C10.0308 1.53125 8.5471 0.916667 7 0.916667C5.4529 0.916667 3.96917 1.53125 2.87521 2.62521C1.78125 3.71917 1.16667 5.2029 1.16667 6.75C1.16667 11.125 7 16.0833 7 16.0833Z" fill="currentColor" />
      <path d="M7 8.79167C8.12758 8.79167 9.04167 7.87758 9.04167 6.75C9.04167 5.62242 8.12758 4.70833 7 4.70833C5.87242 4.70833 4.95833 5.62242 4.95833 6.75C4.95833 7.87758 5.87242 8.79167 7 8.79167Z" fill="var(--icon-cutout, white)" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base("0 0 16 16", props)}>
      <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base("0 0 16 16", props)}>
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base("0 0 16 16", props)}>
      <path d="M12 10L8 6L4 10" stroke="currentColor" strokeWidth="1.46667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base("0 0 14 14", props)}>
      <path d="M2.91667 7H11.0833" stroke="currentColor" strokeWidth="1.28333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base("0 0 14 14", props)}>
      <path d="M2.91667 7H11.0833M7 2.91667V11.0833" stroke="currentColor" strokeWidth="1.28333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base("0 0 20 20", props)}>
      <path d="M16.6667 5L7.5 14.1667L3.33333 10" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base("0 0 22 22", props)}>
      <path d="M19.9192 16.5L12.5858 3.66667C12.4259 3.38452 12.1941 3.14984 11.9138 2.98656C11.6336 2.82329 11.3151 2.73726 10.9908 2.73726C10.6665 2.73726 10.348 2.82329 10.0678 2.98656C9.78761 3.14984 9.55573 3.38452 9.39583 3.66667L2.0625 16.5C1.90088 16.7799 1.81613 17.0976 1.81684 17.4208C1.81756 17.744 1.90371 18.0613 2.06658 18.3405C2.22944 18.6197 2.46322 18.8509 2.74422 19.0106C3.02522 19.1703 3.34346 19.2529 3.66667 19.25H18.3333C18.655 19.2497 18.9709 19.1647 19.2493 19.0037C19.5278 18.8426 19.759 18.6112 19.9196 18.3325C20.0803 18.0539 20.1649 17.7379 20.1648 17.4162C20.1647 17.0945 20.08 16.7786 19.9192 16.5Z" stroke="currentColor" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 8.25V11.9167" stroke="currentColor" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 15.5833H11.01" stroke="currentColor" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M9 16.5C13.1421 16.5 16.5 13.1421 16.5 9C16.5 4.85786 13.1421 1.5 9 1.5C4.85786 1.5 1.5 4.85786 1.5 9C1.5 13.1421 4.85786 16.5 9 16.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12V9M9 6H9.0075" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base("0 0 20 20", props)}>
      <path d="M15.8333 9.16667H4.16667C3.24619 9.16667 2.5 9.91286 2.5 10.8333V16.6667C2.5 17.5871 3.24619 18.3333 4.16667 18.3333H15.8333C16.7538 18.3333 17.5 17.5871 17.5 16.6667V10.8333C17.5 9.91286 16.7538 9.16667 15.8333 9.16667Z" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.83333 9.16667V5.83333C5.83333 4.72826 6.27232 3.66846 7.05372 2.88706C7.83512 2.10565 8.89493 1.66667 10 1.66667C11.1051 1.66667 12.1649 2.10565 12.9463 2.88706C13.7277 3.66846 14.1667 4.72826 14.1667 5.83333V9.16667" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendingIcon(props: IconProps) {
  return (
    <svg {...base("0 0 22 22", props)}>
      <path d="M20.1667 6.41667L12.375 14.2083L7.79167 9.625L1.83333 15.5833" stroke="currentColor" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.6667 6.41667H20.1667V11.9167" stroke="currentColor" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TimerIcon(props: IconProps) {
  return (
    <svg {...base("0 0 20 20", props)}>
      <path d="M8.33333 1.66667H11.6667M10 11.6667L12.5 9.16667" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 18.3333C13.6819 18.3333 16.6667 15.3486 16.6667 11.6667C16.6667 7.98477 13.6819 5 10 5C6.3181 5 3.33333 7.98477 3.33333 11.6667C3.33333 15.3486 6.3181 18.3333 10 18.3333Z" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base("0 0 19 19", props)}>
      <path d="M16.625 11.875V15.0417C16.625 15.4616 16.4582 15.8643 16.1613 16.1613C15.8643 16.4582 15.4616 16.625 15.0417 16.625H3.95833C3.53841 16.625 3.13568 16.4582 2.83875 16.1613C2.54181 15.8643 2.375 15.4616 2.375 15.0417V11.875" stroke="currentColor" strokeWidth="1.74167" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.54167 7.91667L9.5 11.875L13.4583 7.91667" stroke="currentColor" strokeWidth="1.74167" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 11.875V2.375" stroke="currentColor" strokeWidth="1.74167" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M11.25 1.5H4.5C4.10218 1.5 3.72064 1.65804 3.43934 1.93934C3.15804 2.22064 3 2.60218 3 3V15C3 15.3978 3.15804 15.7794 3.43934 16.0607C3.72064 16.342 4.10218 16.5 4.5 16.5H13.5C13.8978 16.5 14.2794 16.342 14.5607 16.0607C14.842 15.7794 15 15.3978 15 15V5.25L11.25 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 1.5V4.5C10.5 4.89782 10.658 5.27936 10.9393 5.56066C11.2206 5.84196 11.6022 6 12 6H15M6 9.75H12M6 12.75H9.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <svg {...base("0 0 14 14", props)}>
      <path d="M9.33333 6.41667L11.6667 4.08333L9.33333 1.75M11.6667 4.08333H2.33333M4.66667 7.58333L2.33333 9.91667L4.66667 12.25M2.33333 9.91667H11.6667" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <svg {...base("0 0 16 16", props)}>
      <path d="M8 13.3333H8.00667M1.33333 5.88C3.16674 4.24015 5.54023 3.33356 8 3.33356C10.4598 3.33356 12.8333 4.24015 14.6667 5.88M3.33333 8.57333C4.57953 7.35182 6.25498 6.66762 8 6.66762C9.74502 6.66762 11.4205 7.35182 12.6667 8.57333M5.66667 10.9533C6.28976 10.3426 7.12749 10.0005 8 10.0005C8.87251 10.0005 9.71024 10.3426 10.3333 10.9533" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MoreVerticalIcon(props: IconProps) {
  return (
    <svg {...base("0 0 16 16", props)}>
      <path d="M8 8.66667C8.36819 8.66667 8.66667 8.36819 8.66667 8C8.66667 7.63181 8.36819 7.33333 8 7.33333C7.63181 7.33333 7.33333 7.63181 7.33333 8C7.33333 8.36819 7.63181 8.66667 8 8.66667Z" stroke="currentColor" strokeWidth="1.73333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 4C8.36819 4 8.66667 3.70152 8.66667 3.33333C8.66667 2.96514 8.36819 2.66667 8 2.66667C7.63181 2.66667 7.33333 2.96514 7.33333 3.33333C7.33333 3.70152 7.63181 4 8 4Z" stroke="currentColor" strokeWidth="1.73333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 13.3333C8.36819 13.3333 8.66667 13.0349 8.66667 12.6667C8.66667 12.2985 8.36819 12 8 12C7.63181 12 7.33333 12.2985 7.33333 12.6667C7.33333 13.0349 7.63181 13.3333 8 13.3333Z" stroke="currentColor" strokeWidth="1.73333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...base("0 0 15 15", props)}>
      <path d="M10 6.875L12.5 4.375L10 1.875M12.5 4.375H2.5M5 8.125L2.5 10.625L5 13.125M2.5 10.625H12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <svg {...base("0 0 15 15", props)}>
      <path d="M9.375 1.25H3.75C3.41848 1.25 3.10054 1.3817 2.86612 1.61612C2.6317 1.85054 2.5 2.16848 2.5 2.5V12.5C2.5 12.8315 2.6317 13.1495 2.86612 13.3839C3.10054 13.6183 3.41848 13.75 3.75 13.75H11.25C11.5815 13.75 11.8995 13.6183 12.1339 13.3839C12.3683 13.1495 12.5 12.8315 12.5 12.5V4.375L9.375 1.25Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.75 1.25V3.75C8.75 4.08152 8.8817 4.39946 9.11612 4.63388C9.35054 4.8683 9.66848 5 10 5H12.5M5 8.125H10M5 10.625H10M5 5.625H6.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...base("0 0 16 16", props)}>
      <path d="M13.3333 8.66667C13.3333 12 11 13.6667 8.22667 14.6333C8.08144 14.6825 7.92369 14.6802 7.78 14.6267C5 13.6667 2.66667 12 2.66667 8.66667V4C2.66667 3.82319 2.7369 3.65362 2.86193 3.5286C2.98695 3.40357 3.15652 3.33333 3.33333 3.33333C4.66667 3.33333 6.33333 2.53333 7.49333 1.52C7.63457 1.39933 7.81424 1.33303 8 1.33303C8.18576 1.33303 8.36543 1.39933 8.50667 1.52C9.67333 2.54 11.3333 3.33333 12.6667 3.33333C12.8435 3.33333 13.013 3.40357 13.1381 3.5286C13.2631 3.65362 13.3333 3.82319 13.3333 4V8.66667Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 8L7.33333 9.33333L10 6.66667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M3.75 9H14.25M9 14.25L14.25 9L9 3.75" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoxMinusIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M15.75 6C15.7497 5.73696 15.6803 5.47861 15.5487 5.25087C15.417 5.02314 15.2278 4.83402 15 4.7025L9.75 1.7025C9.52197 1.57085 9.2633 1.50154 9 1.50154C8.7367 1.50154 8.47803 1.57085 8.25 1.7025L3 4.7025C2.7722 4.83402 2.58299 5.02314 2.45135 5.25087C2.31971 5.47861 2.25027 5.73696 2.25 6V12C2.25027 12.263 2.31971 12.5214 2.45135 12.7491C2.58299 12.9769 2.7722 13.166 3 13.2975L8.25 16.2975C8.47803 16.4292 8.7367 16.4985 9 16.4985C9.2633 16.4985 9.52197 16.4292 9.75 16.2975L15 13.2975C15.2278 13.166 15.417 12.9769 15.5487 12.7491C15.6803 12.5214 15.7497 12.263 15.75 12V6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ThermometerIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M10.5 3V10.905C11.0719 11.2352 11.5189 11.7449 11.7716 12.355C12.0244 12.9652 12.0687 13.6416 11.8978 14.2795C11.7269 14.9174 11.3502 15.4811 10.8263 15.8831C10.3024 16.2852 9.6604 16.5031 9 16.5031C8.3396 16.5031 7.69765 16.2852 7.17372 15.8831C6.64978 15.4811 6.27315 14.9174 6.10222 14.2795C5.9313 13.6416 5.97564 12.9652 6.22836 12.355C6.48109 11.7449 6.92807 11.2352 7.5 10.905V3C7.5 2.60218 7.65804 2.22064 7.93934 1.93934C8.22064 1.65804 8.60218 1.5 9 1.5C9.39782 1.5 9.77936 1.65804 10.0607 1.93934C10.342 2.22064 10.5 2.60218 10.5 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SnowflakeIcon(props: IconProps) {
  return (
    <svg {...base("0 0 18 18", props)}>
      <path d="M1.5 9H16.5M9 1.5V16.5M15 12L12 9L15 6M3 6L6 9L3 12M12 3L9 6L6 3M6 15L9 12L12 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
