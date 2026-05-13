import { ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';

export function JiraLink({ ticket }: { ticket?: string }) {
  const baseUrl = useStore((s) => s.settings.jiraBaseUrl);
  if (!ticket) return <span className="muted">–</span>;
  const href = baseUrl
    ? `${baseUrl}${ticket.trim()}`
    : '#';
  return (
    <a
      className="jira-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (!baseUrl) e.preventDefault();
      }}
    >
      {ticket}
      <ExternalLink size={11} />
    </a>
  );
}
