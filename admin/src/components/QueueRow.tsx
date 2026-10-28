import { formatDate } from '../lib/date';
import { profileUrl } from '../lib/profile';
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  type Account,
  type Platform,
  type Status,
} from '../types';

const BADGE: Record<Platform, string> = {
  instagram: 'border-accent/35 bg-accent/15 text-accent',
  facebook: 'border-[#1877f2]/40 bg-[#1877f2]/15 text-[#6cb2ff]',
};

export function QueueRow({
  row,
  busy,
  onSetStatus,
}: {
  row: Account;
  busy: boolean;
  onSetStatus: (id: string, status: Status) => void;
}) {
  const meta = [
    `Proposé le ${formatDate(row.created_at)}`,
    row.reason ? `« ${row.reason} »` : null,
    row.reviewed_at
      ? `· ${STATUS_LABEL[row.status]} le ${formatDate(row.reviewed_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className="flex items-start justify-between gap-3.5 rounded-[11px] border border-line bg-surface px-[15px] py-[13px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span
            className={`rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.3px] ${BADGE[row.platform]}`}
          >
            {PLATFORM_LABEL[row.platform]}
          </span>
          <a
            href={profileUrl(row.platform, row.username)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink no-underline hover:underline"
          >
            @{row.username}
          </a>
        </div>
        <p className="mt-0.5 text-[12px] text-muted wrap-anywhere">{meta}</p>
      </div>

      <div className="flex flex-none gap-1.5">
        {row.status !== 'approved' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetStatus(row.id, 'approved')}
            className="rounded-[10px] border border-ok/35 bg-ok/15 px-[11px] py-[7px] text-[12.5px] font-semibold text-ok transition hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approuver
          </button>
        )}
        {row.status !== 'rejected' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetStatus(row.id, 'rejected')}
            className="rounded-[10px] border border-err/30 bg-err/10 px-[11px] py-[7px] text-[12.5px] font-semibold text-err transition hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rejeter
          </button>
        )}
      </div>
    </li>
  );
}
