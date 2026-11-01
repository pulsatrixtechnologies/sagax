// Where a field sits, and what it says about itself.
//
// A field that carries its own `label`, where no Label node in the widget
// names it, draws that label as a small caption above itself, tied to it for
// a screen reader (a `<label for>`, or `aria-labelledby` on a group). A
// Label node wins: the words are never drawn twice.
//
// Beside a label in a row a picker drops its box and shows its value alone
// ("bare"). Anywhere else it is the full field, and in a row of fields each
// takes an equal share of at least 160px and wraps under the others when the
// row runs out (WidgetNodes makes such a row wrap). In a card too narrow for
// a label and a field side by side, WidgetNodes stacks the row, so the field
// is drawn as the full field under its label.
import { widgetString, type WidgetNode } from "../../../shared/widget";
import {
  useWidgetForm, widgetFieldId, WidgetCheckbox, WidgetDatePicker, WidgetInput, WidgetRadioGroup, WidgetSelect, WidgetTextarea,
} from "./WidgetControls";
import { WidgetDayPicker } from "./WidgetDayPicker";
import { WidgetTimePicker } from "./WidgetTimePicker";
import type { WidgetWhere } from "./widget-where";

/** Every node a person fills in. */
export const WIDGET_FIELD_TYPES: ReadonlySet<string> = new Set(["Select", "DatePicker", "TimePicker", "DayPicker", "Checkbox", "RadioGroup", "Input", "Textarea"]);
/** The fields that show their value alone beside a label in a row. */
const BARE = new Set(["Select", "DatePicker", "TimePicker", "DayPicker", "Input"]);
/** The fields whose box runs the width it is given. */
const FILLS = new Set(["Select", "DatePicker", "TimePicker", "Input", "Textarea"]);
/** A field's part of a row of fields: an equal share, never under 160px. */
export const WIDGET_FIELD_SHARE = "1 1 160px";

/** A label above its field, whether a Label node or a field's own `label`: the app's form caption
 * (Settings, dialogs), 12px in the secondary ink, 6px off the field. */
export const WIDGET_CAPTION = "ms-0.5 block text-[12px] leading-4 text-ink-secondary";

export function WidgetFieldView({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const form = useWidgetForm();
  if (node.type === "Checkbox") return <WidgetCheckbox node={node} />;
  const name = widgetString(node, "name") ?? "";
  const label = widgetString(node, "label");
  const captioned = label !== undefined && !form.labelled.has(name);
  const inRow = where.axis === "row";
  const bare = inRow && !captioned && node.block !== true && BARE.has(node.type);
  const group = node.type === "RadioGroup" || node.type === "DayPicker";
  const captionId = `${widgetFieldId(form, name)}-label`;
  const labelledBy = captioned && group ? captionId : undefined;
  const control = node.type === "Select" ? <WidgetSelect node={node} bare={bare} />
    : node.type === "DatePicker" ? <WidgetDatePicker node={node} bare={bare} />
      : node.type === "TimePicker" ? <WidgetTimePicker node={node} bare={bare} />
        : node.type === "DayPicker" ? <WidgetDayPicker node={node} labelledBy={labelledBy} end={bare} />
          : node.type === "RadioGroup" ? <WidgetRadioGroup node={node} labelledBy={labelledBy} />
            : node.type === "Input" ? <WidgetInput node={node} bare={bare} />
              : <WidgetTextarea node={node} />;
  const shares = inRow && !bare && (captioned || FILLS.has(node.type));
  if (!captioned && !shares) return control;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" style={shares ? { flex: WIDGET_FIELD_SHARE } : undefined}>
      {captioned && (group
        ? <div id={captionId} dir="auto" className={WIDGET_CAPTION}>{label}</div>
        // a click on the words is a click on the field, as on any form
        : <label id={captionId} htmlFor={widgetFieldId(form, name)} dir="auto" className={WIDGET_CAPTION}>{label}</label>)}
      {control}
    </div>
  );
}
