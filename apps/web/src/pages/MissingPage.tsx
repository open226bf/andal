import { BooksIcon, LockSimpleIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { t } from '../lib/i18n';

/** Lien vers une page illisible ou supprimée: même message dans les deux cas. */
export function MissingPage() {
  useEffect(() => {
    document.title = `${t('Page introuvable')} · Andal`;
  }, []);
  return (
    <main className="missing-page">
      <LockSimpleIcon size={28} aria-hidden />
      <h1>{t('Page introuvable')}</h1>
      <p>{t('Ce lien mène à une page supprimée, ou à une page que vous ne lisez pas.')}</p>
      <Link to="/" className="btn-line">
        <BooksIcon size={18} aria-hidden />
        {t('Retour à la bibliothèque')}
      </Link>
    </main>
  );
}
