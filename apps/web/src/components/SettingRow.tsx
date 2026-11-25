import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { OptionCards } from "@/components/ui/option-cards";
import { Switch } from "@/components/ui/switch";
import { queryErrorText } from "@/components/Status";
import type { SettingOption } from "@/lib/settings-labels";

/**
 * Rows of the settings page (AI-372, mockup direction A). Every write confirms at its control
 * (design.md "Feedback"): "Saving…", then "Saved" beside the setting's name, or the API's message
 * under it.
 */

/** A mutation's state, as `useMutation` returns it. */
export interface SaveState {
  isPending: boolean;
  isSuccess: boolean;
  error: unknown;
}

/** "Saving…" while the write is in flight, "Saved" once it lands; nothing after a failure. */
export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span role="status" className="text-xs">
      {state.error ? null : state.isPending ? (
        <span className="text-muted-foreground">Saving…</span>
      ) : state.isSuccess ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check className="size-3" aria-hidden />
          Saved
        </span>
      ) : null}
    </span>
  );
}

/** The API's message for a failed write, at the control that made it. */
export function SaveError({ state }: { state: SaveState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {queryErrorText(state.error)}
    </p>
  );
}

/** A setting's name, its save status and one line on what it does. */
export function SettingHeading(props: {
  label: ReactNode;
  htmlFor?: string;
  description: ReactNode;
  state: SaveState;
  aside?: ReactNode;
}) {
  const Name = props.htmlFor ? "label" : "span";
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Name htmlFor={props.htmlFor} className="font-medium">
          {props.label}
        </Name>
        <SaveStatus state={props.state} />
        {props.aside && (
          <span className="ml-auto text-xs text-muted-foreground">{props.aside}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{props.description}</p>
    </div>
  );
}

const row = "space-y-2 border-b border-border py-2.5 last:border-b-0";

/** An on/off setting: name and what it does on the left, the switch on the right. */
export function SwitchRow(props: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  state: SaveState;
  /** A note after the description, e.g. who turned it on and when. */
  note?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={row}>
      {/* The whole row is the label, so it is the switch's 44 px target on a phone. */}
      <label
        htmlFor={id}
        className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 max-sm:min-h-11"
      >
        <span className="min-w-0 space-y-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{props.label}</span>
            <SaveStatus state={props.state} />
          </span>
          <span className="block text-xs text-muted-foreground">
            {props.description}
            {props.note && (
              <>
                {" "}
                <span>{props.note}</span>
              </>
            )}
          </span>
        </span>
        <Switch
          id={id}
          aria-label={props.label}
          checked={props.checked}
          disabled={props.disabled}
          onCheckedChange={props.onCheckedChange}
        />
      </label>
      <SaveError state={props.state} />
    </div>
  );
}

/** A picker with fewer than six options: every option shown with its description. */
export function PickerRow<T extends string>(props: {
  label: string;
  description: ReactNode;
  value: T | undefined;
  options: Record<T, SettingOption>;
  disabled?: boolean;
  onValueChange: (value: T) => void;
  state: SaveState;
}) {
  const order = Object.keys(props.options) as T[];
  return (
    <div className={row}>
      <SettingHeading label={props.label} description={props.description} state={props.state} />
      <OptionCards
        label={props.label}
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onValueChange}
        options={order.map((value) => ({ value, ...props.options[value] }))}
      />
      <SaveError state={props.state} />
    </div>
  );
}

/** A setting with its own controls (a number box, a dial and a switch). */
export function SettingRow(props: {
  label: string;
  htmlFor?: string;
  description: ReactNode;
  state: SaveState;
  children: ReactNode;
}) {
  return (
    <div className={row}>
      <SettingHeading
        label={props.label}
        htmlFor={props.htmlFor}
        description={props.description}
        state={props.state}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{props.children}</div>
      <SaveError state={props.state} />
    </div>
  );
}
