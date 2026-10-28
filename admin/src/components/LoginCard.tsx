import { useState, type FormEvent } from 'react';
import { Alert } from './Alert';

export function LoginCard({
  sending,
  sent,
  onSend,
}: {
  sending: boolean;
  sent: boolean;
  onSend: (email: string) => void;
}) {
  const [email, setEmail] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (value) onSend(value);
  }

  return (
    <section className="rounded-[14px] border border-line bg-surface p-5">
      <h2 className="mb-1.5 text-[15px] font-bold tracking-[0.2px]">Connexion</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        Reçois un lien de connexion par e-mail. Seules les adresses présentes
        dans la table <code className="text-[12px] text-ink">admins</code> ont
        accès à cette page.
      </p>

      <form onSubmit={handleSubmit}>
        <label
          htmlFor="email"
          className="mb-1.5 block text-[12.5px] font-semibold text-[#cfcfdb]"
        >
          Adresse e-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="toi@exemple.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-[10px] border border-line bg-bg px-[13px] py-[11px] text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent"
        />

        <button
          type="submit"
          disabled={sending}
          className="mt-[18px] w-full rounded-[10px] bg-accent px-3 py-3 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Envoi…' : 'Recevoir le lien'}
        </button>
      </form>

      {sent && (
        <Alert tone="success">
          Lien envoyé. Ouvre-le depuis ce navigateur pour te connecter.
        </Alert>
      )}
    </section>
  );
}
