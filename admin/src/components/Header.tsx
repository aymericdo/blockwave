export function Header() {
  return (
    <header className="mb-7 flex items-center gap-3">
      <div
        aria-hidden="true"
        className="h-[38px] w-[38px] flex-none rounded-[11px] bg-[linear-gradient(135deg,#f9ce34,#ee2a7b_55%,#6228d7)]"
      />
      <div>
        <h1 className="text-[18px] font-bold tracking-[0.2px]">
          Blockwave · modération
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Valider ou rejeter les comptes proposés.
        </p>
      </div>
    </header>
  );
}
