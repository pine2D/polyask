import { useEffect, useRef, useState } from "react";
import type { DesktopCopy } from "../shared/copy";
import { fillPromptVariables, promptVariables } from "../shared/prompt-variables";

export function PromptTemplateEditor(props: {
  readonly copy: DesktopCopy;
  readonly template: { readonly name: string; readonly text: string };
  readonly onApply: (text: string) => void;
  readonly onBack: () => void;
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const firstInput = useRef<HTMLTextAreaElement>(null);
  const names = promptVariables(props.template.text);
  const preview = fillPromptVariables(props.template.text, values);
  useEffect(() => { firstInput.current?.focus(); }, []);
  return <div className="prompt-variable-editor">
    <header><button type="button" data-template-back onClick={props.onBack}>{props.copy.templateBack}</button>
      <div><h2>{props.copy.templateVariables}</h2><p className="prompt-template-title" title={props.template.name}>{props.template.name}</p></div></header>
    <p className="prompt-variable-hint">{props.copy.templateVariableHint}</p>
    <div className="prompt-variable-fields">
    {names.map((name, index) => <label key={name}>{name}
      <textarea ref={index === 0 ? firstInput : undefined} name={`template-variable-${index}`} required rows={index === 0 ? 4 : 2}
        value={Object.hasOwn(values, name) ? values[name] : ""}
        onChange={event => setValues(previous => ({ ...previous, [name]: event.target.value }))} />
    </label>)}
    <label className="prompt-variable-preview">{props.copy.templatePreview}<textarea name="template-preview" readOnly rows={7} value={preview ?? props.template.text} /></label>
    </div>
    <footer>
    {preview === null ? <p className="prompt-variable-invalid" data-invalid={names.every(name => Object.hasOwn(values, name) && values[name].trim())} role="status">{props.copy.templateInvalid}</p> : <p>{props.copy.templateReplace}</p>}
    <button type="button" className="template-apply" disabled={preview === null} onClick={() => {
      if (preview !== null) props.onApply(preview);
    }}>{props.copy.templateApply}</button>
    </footer>
  </div>;
}
