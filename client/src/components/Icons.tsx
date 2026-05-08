type IconProps = { size?: number; className?: string };

const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const PlusIcon = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

export const DragIcon = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" />
  </svg>
);

export const ChevronLeft = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const ChevronRight = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const MoreIcon = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

export const CheckIcon = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ShareIcon = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);
