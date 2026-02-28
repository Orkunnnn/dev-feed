import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

export function AppIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.5 19H14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 21H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="12" r="1.1" fill="currentColor" />
      <path d="M8 9.5C9.38 9.5 10.5 10.62 10.5 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 7C10.76 7 13 9.24 13 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
