import { ExternalLink } from 'lucide-react';

const JIRA_BASE_URL = 'https://jira.ennit.de/browse/';

export function JiraLink({ ticket }: { ticket?: string }) {
  if (!ticket) return <span className="muted">–</span>;
  const href = `${JIRA_BASE_URL}${ticket.trim()}`;
  return (
    <a className="jira-link" href={href} target="_blank" rel="noreferrer">
      {ticket}
      <ExternalLink size={11} />
    </a>
  );
}
