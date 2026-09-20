import { useMemo, useRef, useState } from "react";

import type { DesktopCopy } from "../shared/copy";
import type { PromptHistoryItem, PromptTemplate } from "../shared/prompt-library";
import { promptVariables } from "../shared/prompt-variables";
import { PromptTemplateEditor } from "./prompt-template-editor";
import { SaveIcon, TrashIcon } from "./icons";

interface PromptLibraryProps {
  readonly copy: DesktopCopy;
  readonly draft: string;
  readonly templates: readonly PromptTemplate[];
  readonly history: readonly PromptHistoryItem[];
  readonly onInsert: (text: string) => void;
  readonly onSave: (input: { readonly name: string; readonly text: string }) => void;
  readonly onDelete: (id: string) => void;
}

export function PromptLibrary(props: PromptLibraryProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const choose = (item: { name: string; text: string }, button: HTMLButtonElement) => {
    if (!promptVariables(item.text).length) { props.onInsert(item.text); return; }
    selectedButton.current = button;
    setEditing(item);
  };
  const starters = [
    { name: props.copy.taskCompare, text: props.copy.taskCompareText },
    { name: props.copy.taskReview, text: props.copy.taskReviewText },
    { name: props.copy.taskTechnical, text: props.copy.taskTechnicalText }
  ];
  const needle = query.trim().toLocaleLowerCase();
  const templates = useMemo(() => props.templates.filter((item) =>
    !needle || `${item.name}\n${item.text}`.toLocaleLowerCase().includes(needle)
  ), [needle, props.templates]);
  const matchedStarters = starters.filter(item => !needle || `${item.name}\n${item.text}`.toLocaleLowerCase().includes(needle));
  const history = useMemo(() => props.history.filter((item) =>
    !needle || item.text.toLocaleLowerCase().includes(needle)
  ), [needle, props.history]);
  const save = () => {
    if (!name.trim() || !props.draft.trim()) return;
    props.onSave({ name: name.trim(), text: props.draft });
    setName("");
  };
  return (
    <section id="prompt-library-panel" className="prompt-library" role="tabpanel" aria-labelledby="command-tab-library">
      <label className="command-search" hidden={!!editing}>
        <span className="sr-only">{props.copy.promptLibrarySearch}</span>
        <input type="search" autoComplete="off" value={query} placeholder={props.copy.promptLibrarySearch} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="prompt-template-save" hidden={!!editing}>
        <input name="prompt-template-name" autoComplete="off" maxLength={80} value={name} placeholder={props.copy.promptTemplateName} aria-label={props.copy.promptTemplateName} onChange={(event) => setName(event.target.value)} />
        <button type="button" disabled={!name.trim() || !props.draft.trim()} onClick={save}><SaveIcon />{props.copy.saveCurrentPrompt}</button>
      </div>
      <div className="prompt-library-results">
        {editing ? <PromptTemplateEditor copy={props.copy} template={editing} onApply={props.onInsert} onBack={() => {
          setEditing(null);
          requestAnimationFrame(() => selectedButton.current?.focus());
        }} /> : null}
        <div hidden={!!editing}>
        <p className="template-variable-hint">{props.copy.templateVariableHint}</p>
        {matchedStarters.length ? <h2>{props.copy.taskTemplates}</h2> : null}
        {matchedStarters.map(item => <button type="button" className="prompt-history-item" key={item.name} onClick={event => choose(item, event.currentTarget)}>{item.name}</button>)}
        {templates.length ? <h2>{props.copy.promptTemplates}</h2> : null}
        {templates.map((item) => (
          <div className="prompt-library-item" key={item.id}>
            <button type="button" title={item.text} onClick={event => choose(item, event.currentTarget)}><strong>{item.name}</strong><small>{item.text}</small></button>
            <button type="button" title={props.copy.deleteTemplate} aria-label={`${props.copy.deleteTemplate}: ${item.name}`} onClick={() => props.onDelete(item.id)}><TrashIcon /></button>
          </div>
        ))}
        {history.length ? <h2>{props.copy.recentQuestions}</h2> : null}
        {history.map((item) => <button type="button" className="prompt-history-item" title={item.text} key={item.id} onClick={() => props.onInsert(item.text)}>{item.text}</button>)}
        {!matchedStarters.length && !templates.length && !history.length ? <p className="command-empty">{props.copy.promptLibraryEmpty}</p> : null}
        </div>
      </div>
    </section>
  );
}
