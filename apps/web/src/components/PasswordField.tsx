import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react';
import { useId, useState, type InputHTMLAttributes, type Ref } from 'react';

/** Champ mot de passe avec bouton Afficher / Masquer. */
export function PasswordField({ label, hint, ref, ...input }: { label: string; hint?: string; ref?: Ref<HTMLInputElement> } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input {...input} ref={ref} id={id} className="input" type={visible ? 'text' : 'password'} aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" className="icon-btn sm" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={visible}>
          {visible ? <EyeSlashIcon size={18} aria-hidden /> : <EyeIcon size={18} aria-hidden />}
        </button>
      </div>
      {hint && (
        <p className="form-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
