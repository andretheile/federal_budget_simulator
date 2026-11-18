/**
 * The few icons the interface needs, drawn inline so nothing is fetched and they take the text
 * colour. All are decorative: the text next to them carries the meaning.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Filled triangle pointing up: the number went up. */
export function TriangleUp(props: IconProps) {
  return (
    <Icon {...props} stroke="none" fill="currentColor">
      <path d="M8 3.2 13.6 12.4H2.4z" />
    </Icon>
  );
}

/** Filled triangle pointing down: the number went down. */
export function TriangleDown(props: IconProps) {
  return (
    <Icon {...props} stroke="none" fill="currentColor">
      <path d="M8 12.8 2.4 3.6h11.2z" />
    </Icon>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 6 4.5 4.5L12.5 6" />
    </Icon>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </Icon>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 8H3m0 0 4-4M3 8l4 4" />
    </Icon>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props} strokeWidth="2">
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
      <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.2 9.1a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
    </Icon>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.7" />
      <path d="M2.6 2.6v2.9h2.9" />
    </Icon>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" />
    </Icon>
  );
}

/** Octagon with a bar: a blocker. */
export function BlockerIcon(props: IconProps) {
  return (
    <Icon {...props} stroke="none" fill="currentColor">
      <path fillRule="evenodd" d="M5.1 1h5.8L15 5.1v5.8L10.9 15H5.1L1 10.9V5.1zM4 6.9v2.2h8V6.9z" />
    </Icon>
  );
}

/** Triangle with an exclamation mark: a major catch or a warning. */
export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.2 14.3 13H1.7z" />
      <path d="M8 6.4v3.2M8 11.4v.1" />
    </Icon>
  );
}

/** Circle with an "i": a minor point. */
export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v3.6M8 5v.1" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Icon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8h9" />
    </Icon>
  );
}

/** Two arrows in opposite directions: an amount moves from one place to another. */
export function ShiftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 5.5h10m0 0L10 3m2.5 2.5L10 8" />
      <path d="M13.5 10.5h-10m0 0L6 8m-2.5 2.5L6 13" />
    </Icon>
  );
}
