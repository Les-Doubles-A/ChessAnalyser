import type { Ref } from 'react';

interface Props {
  ref: Ref<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  busy: boolean;
  onSubmit: (username: string) => void;
}

export function SearchForm({ ref, value, onChange, error, busy, onSubmit }: Props) {
  return (
    <form
      className="search"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor="username">Pseudo chess.com</label>
      <div className="search-row">
        <input
          ref={ref}
          id="username"
          name="username"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="ex. : hikaru"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="username-error"
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Recherche…' : 'Voir mes parties'}
        </button>
      </div>
      <p id="username-error" className="field-error" aria-live="polite">
        {error}
      </p>
    </form>
  );
}
