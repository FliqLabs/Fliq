"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fliqApi } from "../lib/fliq-api";

type DayStatus = "operational" | "degraded" | "outage" | "no_data";
type ComponentState = "healthy" | "degraded" | "down" | "unknown";

type StatusDay = {
  date: string;
  status: DayStatus;
  checks: number;
  uptime_percent: number | null;
};

type StatusComponent = {
  id: string;
  name: string;
  kind: "service" | "provider";
  state: ComponentState;
  days: StatusDay[];
};

type StatusIncident = {
  incident_id: string;
  component: string;
  title: string;
  impact: "degraded" | "outage";
  state: "open" | "resolved";
  summary: string;
  started_at: string;
  resolved_at: string | null;
};

type StatusReport = {
  updated_at: string;
  components: StatusComponent[];
  incidents: StatusIncident[];
};

const providerColors: Record<string, string> = {
  paycrest: "bg-blue-600",
  busha: "bg-violet-600",
  fonbnk: "bg-amber-500",
  bitnob: "bg-blue-500",
  transfi: "bg-blue-700",
};

const providerSymbols: Record<string, string> = {
  paycrest: "✦",
  busha: "ϟ",
  fonbnk: "◉",
  bitnob: "•••",
  transfi: "◎",
};

const barColors: Record<DayStatus, string> = {
  operational: "bg-[#238344]",
  degraded: "bg-[#f0a817]",
  outage: "bg-[#e34b4b]",
  no_data: "bg-[#454545]",
};

const stateColors: Record<ComponentState, string> = {
  healthy: "text-[#22b45c]",
  degraded: "text-[#f0a817]",
  down: "text-[#ef5555]",
  unknown: "text-[#858585]",
};

const stateLabels: Record<ComponentState, string> = {
  healthy: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function getDescription(component: StatusComponent) {
  return component.kind === "provider" ? "Payout provider" : "Fliq service";
}

function getOverallState(components: StatusComponent[]): ComponentState {
  if (components.length === 0) return "unknown";

  const services = components.filter((item) => item.kind === "service");
  const providers = components.filter((item) => item.kind === "provider");

  if (services.some((item) => item.state === "down")) return "down";

  if (
    providers.length > 0 &&
    providers.every((item) => item.state === "down")
  ) {
    return "down";
  }

  if (services.some((item) => item.state === "degraded")) return "degraded";

  if (providers.some((item) => item.state === "degraded" || item.state === "down")) {
    return "degraded";
  }

  if (components.some((item) => item.state === "unknown")) return "unknown";

  return "healthy";
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

function formatIncidentDate(value: string) {
  const date = new Date(value);
  const now = new Date();

  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return `Today ${new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Africa/Lagos",
    }).format(date)}`;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  }).format(date);
}

function SectionPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[17px] border border-[#303030] bg-[#1a1a1a] px-[22px] pt-[21px]">
      <h2 className="mb-[5px] text-[11px] font-semibold text-[#a5a5a5]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function HistoryBars({ days }: { days: StatusDay[] }) {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="min-w-0">
      {ordered.length > 0 ? (
        <div
          className="grid h-[24px] min-w-[350px] gap-[2px]"
          style={{
            gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))`,
          }}
          role="img"
          aria-label={`${ordered.length} days of uptime history`}
        >
          {ordered.map((day) => (
            <span
              key={day.date}
              title={`${day.date}: ${day.status}${
                day.uptime_percent === null
                  ? ""
                  : ` · ${day.uptime_percent.toFixed(2)}% uptime`
              } · ${day.checks} checks`}
              className={`rounded-[2px] ${barColors[day.status]}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#777]">No history available</p>
      )}
    </div>
  );
}

function ComponentRow({
  component,
}: {
  component: StatusComponent;
}) {
  const name = normalized(component.name);
  const isProvider = component.kind === "provider";
  const symbol = providerSymbols[name];

  return (
    <div className="grid min-h-[63px] grid-cols-[minmax(205px,225px)_minmax(0,1fr)_105px] items-center gap-4 border-b border-[#303030] py-[10px] last:border-b-0 max-md:grid-cols-[minmax(145px,175px)_minmax(0,1fr)] max-md:gap-3">
      <div className="flex min-w-0 items-center gap-[14px]">
        <div
          className={`flex size-[29px] shrink-0 items-center justify-center rounded-full border border-white/10 text-[14px] text-white ${
            isProvider
              ? providerColors[name] ?? "bg-[#303030]"
              : "bg-transparent text-[#bcbcbc]"
          }`}
        >
          {isProvider ? symbol ?? component.name.slice(0, 1) : (
            <span aria-hidden="true">
              {name === "api" ? "➤" : name === "rate sampler" ? "↶" : "+"}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="truncate text-[14px] leading-[19px] text-[#f1f1f1]">
            {component.name}
          </p>
          <p className="mt-[2px] text-[11px] leading-[14px] text-[#929292]">
            {getDescription(component)}
          </p>
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto">
        <HistoryBars days={component.days} />
      </div>

      <div
        className={`hidden items-center justify-end gap-[7px] text-right text-[12px] md:flex ${stateColors[component.state]}`}
      >
        <span className="size-[6px] shrink-0 rounded-full bg-current" />
        <span className="whitespace-nowrap">{stateLabels[component.state]}</span>
      </div>

      <div
        className={`col-start-1 flex items-center gap-2 pl-[43px] text-[11px] md:hidden ${stateColors[component.state]}`}
      >
        <span className="size-[6px] rounded-full bg-current" />
        {stateLabels[component.state]}
      </div>
    </div>
  );
}

function IncidentRow({ incident }: { incident: StatusIncident }) {
  const open = incident.state === "open";

  return (
    <article className="grid grid-cols-[105px_minmax(0,1fr)_95px] gap-4 py-[7px] max-sm:grid-cols-[75px_minmax(0,1fr)] max-sm:gap-2">
      <p className="pt-[2px] text-[12px] text-[#999]">
        {formatIncidentDate(incident.started_at)}
      </p>

      <div className="min-w-0">
        <h3 className="text-[13px] leading-5 text-[#ededed]">
          {incident.title}
        </h3>
        <p className="text-[12px] leading-[18px] text-[#999]">
          {incident.summary}
        </p>
      </div>

      <p
        className={`pt-[2px] text-right text-[12px] max-sm:col-start-2 max-sm:text-left ${
          open ? "text-[#f0a817]" : "text-[#22b45c]"
        }`}
      >
        {open ? "Monitoring" : "Resolved"}
      </p>
    </article>
  );
}

function StatusHeader() {
  return (
    <header className="flex h-[64px] items-center justify-between">
      <Link href="/" className="flex items-center gap-[9px]">
        <Image src="/logo.png" width={26} height={26} alt="" />
        <span className="text-[19px] font-bold tracking-[-0.7px] text-white">
          fliq
        </span>
      </Link>

      <nav className="flex items-center gap-[22px] text-[13px] text-[#999] max-sm:gap-3">
        <Link className="hidden transition hover:text-white sm:block" href="/#rates">
          Rates
        </Link>
        <Link className="hidden transition hover:text-white sm:block" href="/#developers">
          Docs
        </Link>
        <Link className="hidden transition hover:text-white sm:block" href="/#agents">
          Agents
        </Link>
        <Link className="hidden transition hover:text-white sm:block" href="/pricing">
          Pricing
        </Link>
        <Link className="text-white" href="/status">
          Status
        </Link>
        <Link className="hidden transition hover:text-white sm:block" href="/sign-in">
          Sign in
        </Link>
        <Link
          href="/sign-in"
          className="rounded-[10px] bg-white px-[14px] py-[9px] text-[12px] font-semibold text-black transition hover:bg-zinc-200"
        >
          Get a key
        </Link>
      </nav>
    </header>
  );
}

function StatusFooter() {
  return (
    <footer className="mt-[64px] flex flex-wrap items-center justify-between gap-5 border-t border-[#303030] py-[25px] text-[12px] text-[#777]">
      <div className="flex items-center gap-[9px]">
        <Image src="/logo.png" width={19} height={19} alt="" />
        <span>Built on NEAR · MIT licence · NEAR HACKATHON 2026</span>
      </div>

      <nav className="flex flex-wrap gap-5">
        <Link href="/#rates" className="hover:text-white">Rates</Link>
        <Link href="/#developers" className="hover:text-white">Docs</Link>
        <Link href="/status" className="hover:text-white">Status</Link>
        <Link href="/#trust" className="hover:text-white">Sample receipt</Link>
        <Link href="https://github.com/FliqLabs/Fliq" className="hover:text-white">GitHub</Link>
        <Link href="https://x.com" className="hover:text-white">X</Link>
      </nav>
    </footer>
  );
}

export function StatusPageClient() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["public-status"],
    queryFn: () => fliqApi<StatusReport>("status"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const components = data?.components ?? [];
  const services = components.filter((item) => item.kind === "service");
  const providers = components.filter((item) => item.kind === "provider");

  const overall = getOverallState(components);
  const degradedServices = services.filter(
    (item) => item.state === "degraded",
  ).length;
  const degradedProviders = providers.filter(
    (item) => item.state === "degraded" || item.state === "down",
  ).length;

  const summary =
    overall === "healthy"
      ? "All services and providers are operating normally"
      : overall === "degraded"
        ? degradedServices > 0 && degradedProviders > 0
          ? "Some Fliq services and payout providers are degraded"
          : degradedServices > 0
            ? "Some Fliq services are experiencing degraded performance"
            : "One or more payout providers are degraded"
        : overall === "down"
          ? "One or more systems are currently unavailable"
          : "System health information is unavailable";

  return (
    <main className="min-h-screen bg-[#171717] text-white">
      <div className="mx-auto w-full max-w-[1100px] px-5 sm:px-7">
        <StatusHeader />

        <section className="mb-[22px] mt-[47px] flex flex-wrap items-center justify-between gap-5">
          <div>
            <h1 className="text-[34px] font-semibold leading-[1.2] tracking-[-1.1px] text-[#f5f5f5] sm:text-[34px]">
              {isPending ? "Checking system status" :
                isError ? "Unable to check system status" :
                  overall === "healthy" ? "All systems operational" :
                    overall === "degraded" ? "Some systems degraded" :
                      overall === "down" ? "System outage detected" : "System status unknown"}
            </h1>

            <p className="mt-[6px] text-[13px] text-[#999]">
              {isPending
                ? "Connecting to Fliq monitoring..."
                : isError
                  ? error instanceof Error ? error.message : "Please try again shortly."
                  : data?.updated_at
                    ? `Checked ${formatCheckedAt(data.updated_at)} WAT · ${summary}`
                    : summary}
            </p>
          </div>

          {!isPending && !isError && (
            <span
              className={`inline-flex items-center gap-[9px] rounded-full px-[13px] py-[8px] text-[12px] font-semibold ${
                overall === "healthy"
                  ? "bg-[#10351f] text-[#25b65d]"
                  : overall === "degraded"
                    ? "bg-[#382b0c] text-[#f0b323]"
                    : overall === "unknown"
                      ? "bg-[#292929] text-[#aaa]"
                      : "bg-[#3b1717] text-[#ef6262]"
              }`}
            >
              <span className="size-[7px] rounded-full bg-current" />
              {overall === "healthy" ? "Operational" : stateLabels[overall]}
            </span>
          )}

          {isError && (
            <button
              onClick={() => refetch()}
              className="rounded-lg border border-[#444] px-4 py-2 text-sm text-white hover:bg-[#252525]"
            >
              Retry
            </button>
          )}
        </section>

        {data && (
          <div className="space-y-[13px]">
            <SectionPanel title="FLIQ">
              {services.length > 0 ? (
                services.map((component) => (
                  <ComponentRow key={component.id} component={component} />
                ))
              ) : (
                <p className="py-6 text-sm text-[#888]">No infrastructure data available.</p>
              )}
            </SectionPanel>

            <SectionPanel title="PROVIDERS">
              {providers.length > 0 ? (
                providers.map((component) => (
                  <ComponentRow key={component.id} component={component} />
                ))
              ) : (
                <p className="py-6 text-sm text-[#888]">No provider data available.</p>
              )}
            </SectionPanel>

            <SectionPanel title="INCIDENTS">
              {data.incidents?.length ? (
                [...data.incidents]
                  .sort(
                    (a, b) =>
                      new Date(b.started_at).getTime() -
                      new Date(a.started_at).getTime(),
                  )
                  .map((incident) => (
                    <IncidentRow key={incident.incident_id} incident={incident} />
                  ))
              ) : (
                <p className="py-6 text-[12px] text-[#888]">
                  No incidents reported.
                </p>
              )}
            </SectionPanel>
          </div>
        )}

        {isPending && (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-[190px] animate-pulse rounded-[17px] border border-[#303030] bg-[#1a1a1a]"
              />
            ))}
          </div>
        )}

        <StatusFooter />
      </div>
    </main>
  );
}