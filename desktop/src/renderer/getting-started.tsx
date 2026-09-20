import type { CommandDescriptor, CommandId } from "../shared/commands";
import type { DesktopCopy } from "../shared/copy";

interface GettingStartedProps {
  readonly copy: DesktopCopy;
  readonly commands: readonly CommandDescriptor[];
  readonly onExecute: (id: CommandId) => void;
}

const STEPS: readonly { title: keyof DesktopCopy; body: keyof DesktopCopy; command: CommandId }[] = [
  { title: "guideChooseTitle", body: "guideChooseBody", command: "open-sites" },
  { title: "guideLoginTitle", body: "guideLoginBody", command: "open-site-health" },
  { title: "guideAskTitle", body: "guideAskBody", command: "focus-prompt" },
  { title: "guideCompareTitle", body: "guideCompareBody", command: "collect-compare" }
];

export function GettingStarted({ copy, commands, onExecute }: GettingStartedProps): React.JSX.Element {
  return (
    <section id="getting-started-panel" className="getting-started" role="tabpanel" aria-labelledby="command-tab-guide">
      <p className="getting-started-intro">{copy.guideIntro}</p>
      <ol>
        {STEPS.map((step) => {
          const command = commands.find((item) => item.id === step.command);
          return <li className="getting-started-step" key={step.command}>
            <h2>{copy[step.title]}</h2>
            <p>{copy[step.body]}</p>
            {command ? <button type="button" onClick={() => onExecute(command.id)}>{copy[command.labelKey]}</button> : null}
          </li>;
        })}
      </ol>
      <p className="getting-started-note">{copy.guideReturnHint}</p>
    </section>
  );
}
