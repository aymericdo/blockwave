import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Alert } from './components/Alert';
import { Dashboard } from './components/Dashboard';
import { Header } from './components/Header';
import { LoginCard } from './components/LoginCard';
import { stripAuthFragment } from './lib/auth';
import { configured, supabase } from './lib/supabase';
import type { Account, PlatformFilter, Status } from './types';

const COLUMNS = 'id, platform, username, status, reason, created_at, reviewed_at';

/* Cible du lien magique : l'origine courante, sans « index.html » final.
 * Supabase refuse un `redirect_to` absent de son allowlist, et personne ne
 * pense à y déclarer `/index.html` en plus de `/`. */
function redirectTarget(): string {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/index\.html$/, '');
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [checking, setChecking] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [tab, setTab] = useState<Status>('pending');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');

  /* Un seul abonnement à l'auth : INITIAL_SESSION couvre le cas « déjà
   * connecté », SIGNED_IN le retour du lien magique. */
  useEffect(() => {
    if (!supabase) return;

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      stripAuthFragment();
      setSession(next);
      setAuthReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!supabase) return;

    const { data, error: queryError } = await supabase
      .from('accounts')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (queryError) {
      setError(queryError.message);
      return;
    }

    setRows((data ?? []) as Account[]);
  }, []);

  /* `is_admin()` est la seule autorisation qui compte : même en modifiant
   * cette page, on n'écrit rien sans appartenir à la table `admins`. */
  useEffect(() => {
    if (!supabase || !session) {
      setIsAdmin(null);
      setRows([]);
      setChecking(false);
      return;
    }

    let alive = true;
    setChecking(true);
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: rpcError } = await supabase.rpc('is_admin');
      if (!alive) return;

      if (rpcError) {
        setError(rpcError.message);
        setIsAdmin(null);
        setChecking(false);
        setLoading(false);
        return;
      }

      const admin = Boolean(data);
      setIsAdmin(admin);

      if (admin) await refresh();
      if (!alive) return;
      setChecking(false);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [session, refresh]);

  const sendMagicLink = useCallback(async (email: string) => {
    if (!supabase) return;

    setSending(true);
    setError(null);
    setSent(false);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTarget(),
      },
    });

    if (otpError) setError(otpError.message);
    else setSent(true);

    setSending(false);
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const setStatus = useCallback(
    async (id: string, status: Status) => {
      if (!supabase || !session) return;

      setBusyId(id);
      setError(null);

      const { error: updateError } = await supabase
        .from('accounts')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: session.user.id,
        })
        .eq('id', id);

      if (updateError) setError(updateError.message);
      else await refresh();

      setBusyId(null);
    },
    [session, refresh],
  );

  const forbidden =
    session && isAdmin === false
      ? `Le compte « ${session.user.email} » est authentifié mais n'est pas administrateur. ` +
        'Ajoute-le à la table admins (voir supabase/schema.sql, section 6).'
      : null;

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pt-10 pb-20">
      <Header />

      {error && <Alert tone="error">{error}</Alert>}
      {forbidden && <Alert tone="warn">{forbidden}</Alert>}

      {!configured && (
        <Alert tone="warn">
          Configuration manquante : renseigne <code>supabaseUrl</code> et{' '}
          <code>supabaseAnonKey</code> dans <code>config.js</code>.
        </Alert>
      )}

      {configured && (!authReady || checking) && (
        <p className="py-[26px] text-center text-[13.5px] text-muted">
          Chargement…
        </p>
      )}

      {configured && authReady && !session && !checking && (
        <LoginCard sending={sending} sent={sent} onSend={sendMagicLink} />
      )}

      {configured && session && isAdmin && (
        <Dashboard
          email={session.user.email ?? ''}
          rows={rows}
          tab={tab}
          platformFilter={platformFilter}
          loading={loading}
          busyId={busyId}
          onTab={setTab}
          onPlatformFilter={setPlatformFilter}
          onSignOut={signOut}
          onSetStatus={setStatus}
        />
      )}
    </div>
  );
}
