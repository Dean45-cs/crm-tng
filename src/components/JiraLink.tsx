import { ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';

const FALLBACK_BASE_URL = 'https://jira.ennit.de/browse/';

export function JiraLink({ ticket }: { ticket?: string }) {
  const configured = useStore((s) => s.settings.jiraBaseUrl);
  if (!ticket) return <span className="muted">–</span>;
  const base = configured || FALLBACK_BASE_URL;
  const href = `${base.endsWith('/') ? base : `${base}/`}${ticket.trim()}`;
  return (
    <a className="jira-link" href={href} target="_blank" rel="noreferrer">
      {ticket}
      <ExternalLink size={11} />
    </a>
  );
}
