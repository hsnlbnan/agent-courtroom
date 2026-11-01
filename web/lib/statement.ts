// An opening or closing statement as the record shows it: the member's own heading and
// "Summary:" label dropped (the record already names them), and the vote word, which the
// protocol keeps as a token (go / no-go / conditional), in the UI's language.
const VOTE_LINE = /^((?:\*\*)?(?:Oy|Vote|Geçici oy|Provisional vote):?(?:\*\*)?:?\s*)?(no-go|conditional|go)\b/gim;

export function statementBody(body: string, voteName: (vote: string) => string) {
  return body
    .replace(/^\s*#+.*\n+/, '')
    .replace(/^\*\*(Summary|Özet):?\*\*\s*/i, '')
    .replace(VOTE_LINE, (_m, lead: string | undefined, v: string) => `${lead ?? ''}${voteName(v.toLowerCase())}`);
}

/** The one-line gist of a statement for the stage: its summary sentence, without Markdown. */
export const statementGist = (body: string) => (body.match(/\*\*(?:Summary|Özet):?\*\*\s*(.+)/i)?.[1] ?? body).replace(/[*#`]/g, '').trim();
