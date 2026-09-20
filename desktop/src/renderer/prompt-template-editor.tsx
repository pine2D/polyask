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
    <button type="button" onClick={props.onBack}>{props.copy.templateBack}</button>
    <h2>{props.template.name} · {props.copy.templateVariables}</h2>
    <p>{props.copy.templateVariableHint}</p>
    {names.map((name, index) => <label key={name}>{name}
      <textarea ref={index === 0 ? firstInput : undefined} name={`template-variable-${index}`} required rows={index === 0 ? 4 : 2}
        value={Object.hasOwn(values, name) ? values[name] : ""}
        onChange={event => setValues(previous => ({ ...previous, [name]: event.target.value }))} />
    </label>)}
    <label>{props.copy.templatePreview}<textarea name="template-preview" readOnly rows={7} value={preview ?? props.template.text} /></label>
    <p>{props.copy.templateReplace}</p>
    {preview === null ? <p role="status">{props.copy.templateInvalid}</p> : null}
    <button type="button" className="template-apply" disabled={preview === null} onClick={() => {
      if (preview !== null) props.onApply(preview);
    }}>{props.copy.templateApply}</button>
  </div>;
}
