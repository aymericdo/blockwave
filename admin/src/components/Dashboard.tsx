import { QueueRow } from './QueueRow';
import {
  PLATFORMS,
  PLATFORM_LABEL,
  STATUSES,
  type Account,
  type PlatformFilter,
  type Status,
} from '../types';

const TAB_LABEL: Record<Status, string> = {
  pending: 'En attente',
  approved: 'Approuvés',
  rejected: 'Rejetés',
};

export function Dashboard({
  email,
  rows,
  tab,
  platformFilter,
  loading,
  busyId,
  onTab,
  onPlatformFilter,
  onSignOut,
  onSetStatus,
}: {
  email: string;
  rows: Account[];
  tab: Status;
  platformFilter: PlatformFilter;
  loading: boolean;
  busyId: string | null;
  onTab: (status: Status) => void;
  onPlatformFilter: (filter: PlatformFilter) => void;
  onSignOut: () => void;
  onSetStatus: (id: string, status: Status) => void;
}) {
  /* Le filtre de réseau s'applique avant les onglets : les compteurs affichés
   * doivent décrire ce qu'on voit, pas la table entière. */
  const scoped =
    platformFilter === 'all'
      ? rows
      : rows.filter((row) => row.platform === platformFilter);

  const visible = scoped.filter((row) => row.status === tab);

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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {STATUSES.map((status) => {
            const selected = status === tab;
            const count = scoped.filter((row) => row.status === status).length;

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

        <label className="flex items-center gap-2 text-[12px] text-muted">
          Réseau
          <select
            value={platformFilter}
            onChange={(event) =>
              onPlatformFilter(event.target.value as PlatformFilter)
            }
            className="rounded-[9px] border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            <option value="all">Tous</option>
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {PLATFORM_LABEL[platform]}
              </option>
            ))}
          </select>
        </label>
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
