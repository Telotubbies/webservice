// "Learn more" link for empty states (roadmap 8.5). One shared component so
// every help link looks and behaves the same (new tab, same style).

import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon';
import { helpUrl } from './help';

export function HelpLink({ doc, label }: { doc: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={helpUrl(doc)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue"
    >
      {label ?? t('onb.learnMore')} <Icon name="external-link" size={12} />
    </a>
  );
}
