import { QueueRow } from './QueueRow';
import { STATUSES, type Account, type Status } from '../types';

const TAB_LABEL: Record<Status, string> = {
  pending: 'En attente',
  approved: 'Approuvés',
  rejected: 'Rejetés',
};

export function Dashboard({
  email,
  rows,
  tab,
  loading,
  busyId,
  onTab,
  onSignOut,
  onSetStatus,
}: {
  email: string;
  rows: Account[];
  tab: Status;
  loading: boolean;
  busyId: string | null;
  onTab: (status: Status) => void;
  onSignOut: () => void;
  onSetStatus: (id: string, status: Status) => void;
}) {
  const visible = rows.filter((row) => row.status === tab);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted">{email}</span>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-[10px] border border-line px-3 py-2 text-[13px] font-medium text-muted transition hover:text-ink"
        >
          Se déconnecter
        </button>
      </div>

      <div role="tablist" className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map((status) => {
          const selected = status === tab;
          const count = rows.filter((row) => row.status === status).length;

          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onTab(status)}
              className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                selected
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-surface-2 text-muted hover:text-ink'
              }`}
            >
              {TAB_LABEL[status]}{' '}
              <span className={selected ? 'text-white/70' : 'text-muted'}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((row) => (
          <QueueRow
            key={row.id}
            row={row}
            busy={busyId === row.id}
            onSetStatus={onSetStatus}
          />
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="py-[26px] text-center text-[13.5px] text-muted">
          {loading ? 'Chargement…' : 'Aucun compte dans cet onglet.'}
        </p>
      )}
    </section>
  );
}
