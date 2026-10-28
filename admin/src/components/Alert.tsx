import type { ReactNode } from 'react';

const TONES = {
  warn: 'border-warn/40 bg-warn/10 text-[#f7d178]',
  error: 'border-err/35 bg-err/10 text-[#ffb3b3]',
  success: 'border-ok/35 bg-ok/10 text-[#8ce6b0]',
} as const;

export function Alert({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mt-3 mb-1 rounded-[9px] border px-3 py-2.5 text-[13px] ${TONES[tone]}`}
    >
      {children}
    </p>
  );
}
