// "Learn more" link for empty states (roadmap 8.5). One shared component so
// every help link looks the same. The in-app guide opens in place; an external docs site in a new tab.

import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon';
import { helpUrl } from './help';

export function HelpLink({ doc, label }: { doc: string; label?: string }) {
  const { t } = useTranslation();
  const href = helpUrl(doc);
  const cls = 'inline-flex items-center gap-1 text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue';
  // the in-app guide opens in place; an external docs site opens in a new tab
  return href.startsWith('/')
    ? <Link to={href} className={cls}>{label ?? t('onb.learnMore')}</Link>
    : (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {label ?? t('onb.learnMore')} <Icon name="external-link" size={12} />
      </a>
    );
}
