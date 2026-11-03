import { AccessMark } from '@andal/ui';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { Cloth } from '../lib/api';
import { Logo } from './Logo';

/** Les dos de l'étagère d'accueil: des volumes d'exemple, pas des données. */
const SPINES: { cloth: Cloth; label: string; height: number; lean?: boolean }[] = [
  { cloth: 'identite', label: 'Architecture', height: 236 },
  { cloth: 'plateforme', label: 'Plateforme', height: 204 },
  { cloth: 'paiements', label: 'API Paiements', height: 268 },
  { cloth: 'donnees', label: 'Données', height: 188 },
  { cloth: 'mobile', label: 'Runbooks', height: 226 },
  { cloth: 'design', label: 'Décisions', height: 212 },
  { cloth: 'identite', label: 'Sécurité', height: 198, lean: true },
];

/**
 * Les écrans sans session (connexion, invitation, réinitialisation): la marque
 * à gauche, une étagère de volumes reliés; le formulaire à droite, sur papier.
 * Sur mobile, la marque se resserre en bandeau au-dessus du formulaire.
 */
export function AuthCard({ title, documentTitle, children }: { title: string; documentTitle?: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${documentTitle ?? title} · Andal`;
  }, [title, documentTitle]);
  return (
    <main className="auth">
      <section className="brand" aria-label="Andal">
        <p className="brand-name">
          <Logo size={30} />
          Andal
        </p>
        <div className="brand-copy">
          <p className="brand-title">Votre documentation technique, reliée en volumes.</p>
          <p className="brand-text">
            Specs OpenAPI, diagrammes et runbooks vivent dans les pages, et chaque page dit qui peut <AccessMark level="write" /> écrire, <AccessMark level="comment" /> commenter et{' '}
            <AccessMark level="read" /> lire.
          </p>
        </div>
        <div className="brand-shelf" aria-hidden>
          {SPINES.map((spine, i) => (
            <span key={spine.label} className="brand-spine" data-vol={spine.cloth} data-lean={spine.lean || undefined} style={{ '--h': `${spine.height}px`, '--i': i } as CSSProperties}>
              <b>{i + 1}</b>
              <span>{spine.label}</span>
            </span>
          ))}
        </div>
        <p className="brand-foot">Libre et auto-hébergé: votre doc reste chez vous.</p>
      </section>
      <section className="auth-pane" aria-labelledby="auth-title">
        <div className="auth-form">
          <h1 id="auth-title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className="form-error" role="alert">
      <WarningCircleIcon size={18} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function FormOk({ children }: { children: ReactNode }) {
  return (
    <p className="form-ok" role="status">
      <CheckCircleIcon size={18} aria-hidden />
      <span>{children}</span>
    </p>
  );
}
