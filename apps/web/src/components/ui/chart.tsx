// shadcn/ui chart wrapper over recharts (ADR-0045), adapted to the design tokens in index.css:
// axes, grid and tooltip use the surface, text and line tokens; each series colour is a token
// named in the ChartConfig (e.g. `var(--running)`). Dark mode comes from the tokens, so there is
// no per-theme colour map. Series colours reach recharts as `var(--color-<key>)`.
import * as React from "react";
import * as RechartsPrimitive from "recharts";
import type { LegendPayload, TooltipContentProps, TooltipPayloadEntry } from "recharts";
import { cn } from "@/lib/utils";

/** One entry per series (a `dataKey`): its label and its token colour, `var(--<token>)`. */
export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; icon?: React.ComponentType; color?: string }
>;

type ChartContextProps = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

type ResponsiveContainerProps = React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>;

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: ResponsiveContainerProps["children"];
  /** Size before the first measure; tests set it because jsdom has no layout. */
  initialDimension?: ResponsiveContainerProps["initialDimension"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
          "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border",
          "[&_.recharts-radial-bar-background-sector]:fill-muted",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-border",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

/** Sets `--color-<key>` on the chart from each series' token, so marks can use it. */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const vars = Object.entries(config)
    .filter(([, item]) => item.color)
    .map(([key, item]) => `  --color-${key}: ${item.color};`);
  if (!vars.length) return null;
  return <style>{`[data-chart=${id}] {\n${vars.join("\n")}\n}`}</style>;
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: Partial<TooltipContentProps> &
  React.ComponentProps<"div"> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: "line" | "dot" | "dashed";
    nameKey?: string;
    labelKey?: string;
  }) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? "value"}`;
    const itemConfig = configForPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label;
    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
      );
    }
    if (!value) return null;
    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        "grid min-w-32 items-start gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs shadow-md",
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1">
        {payload.map((item, index) => {
          const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`;
          const itemConfig = configForPayload(config, item, key);
          const indicatorColor = color ?? item.payload?.fill ?? item.color;

          return (
            <div
              key={`${item.dataKey ?? index}`}
              className={cn(
                "flex w-full flex-wrap items-stretch gap-2 [&>svg]:size-2.5 [&>svg]:text-muted-foreground",
                indicator === "dot" && "items-center",
              )}
            >
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, payload)
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn("shrink-0 rounded-[2px]", {
                          "size-2.5": indicator === "dot",
                          "w-1": indicator === "line",
                          "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                          "my-0.5": nestLabel && indicator === "dashed",
                        })}
                        style={{ backgroundColor: indicatorColor, borderColor: indicatorColor }}
                      />
                    )
                  )}
                  <div
                    className={cn(
                      "flex flex-1 justify-between leading-none",
                      nestLabel ? "items-end" : "items-center",
                    )}
                  >
                    <div className="grid gap-1">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-muted-foreground">
                        {itemConfig?.label ?? item.name}
                      </span>
                    </div>
                    {item.value !== undefined && (
                      <span className="font-medium tabular-nums">
                        {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> & {
  payload?: ReadonlyArray<LegendPayload>;
  verticalAlign?: "top" | "middle" | "bottom";
  hideIcon?: boolean;
  nameKey?: string;
}) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className,
      )}
    >
      {payload.map((item) => {
        const key = `${nameKey ?? item.dataKey ?? "value"}`;
        const itemConfig = configForPayload(config, item, key);
        return (
          <div
            key={`${item.value}`}
            className="flex items-center gap-1.5 [&>svg]:size-3 [&>svg]:text-muted-foreground"
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

/** The config entry for a tooltip or legend item: by a named field on its datum, else by key. */
function configForPayload(
  config: ChartConfig,
  item: TooltipPayloadEntry | LegendPayload | undefined,
  key: string,
) {
  const datum: unknown = item && "payload" in item ? item.payload : undefined;
  const named = (source: unknown) =>
    source && typeof source === "object" && key in source
      ? (source as Record<string, unknown>)[key]
      : undefined;
  const fromItem = named(item);
  const fromDatum = named(datum);
  const configKey =
    typeof fromItem === "string" ? fromItem : typeof fromDatum === "string" ? fromDatum : key;
  return config[configKey] ?? config[key];
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};
