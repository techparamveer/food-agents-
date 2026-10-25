"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/logo";
import { clock, useDashboard } from "@/components/dashboard/data";
import { useLiveNow } from "@/components/dashboard/clock";
import { Icon, type IconName } from "@/components/dashboard/icon";
import { MealCheckView } from "@/components/dashboard/meal-check-view";
import { OrderBuilderPane } from "@/components/dashboard/order-builder-pane";
import { OrdersView } from "@/components/dashboard/orders-view";
import { OverviewView } from "@/components/dashboard/overview-view";
import { RestaurantTile } from "@/components/dashboard/parts";
import { PlannerPane, type PlannerApi, type PlannerContext } from "@/components/dashboard/planner-pane";
import { RestaurantsView } from "@/components/dashboard/restaurants-view";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { isPlaced } from "@/lib/plan-sync";
import { deadlineApproximation, deadlineWindowPhase } from "@/lib/countdown";
import type { Section, SettingsTab } from "@/lib/sections";

const NAV: { id: Section; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "restaurants", label: "Restaurants", icon: "store" },
  { id: "orders", label: "Orders", icon: "receipt" },
  { id: "mealcheck", label: "Meal check", icon: "scan" },
];

const LINKS: { tab: SettingsTab; label: string; icon: IconName }[] = [
  { tab: "event", label: "Event", icon: "calendar" },
  { tab: "dietary", label: "Dietary mix", icon: "leaf" },
  { tab: "notifications", label: "Notifications", icon: "bell" },
];

const ACCOUNT_MENU = LINKS;

const calendarDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/* "Getting started" stays dismissed per browser. */
const CHECKLIST_KEY = "comeda:checklist-dismissed";
const checklistListeners = new Set<() => void>();
const checklistStore = {
  subscribe(listener: () => void) {
    checklistListeners.add(listener);
    return () => checklistListeners.delete(listener);
  },
  get: () => window.localStorage.getItem(CHECKLIST_KEY) === "1",
  dismiss() {
    window.localStorage.setItem(CHECKLIST_KEY, "1");
    checklistListeners.forEach((l) => l());
  },
};

export function HomeScreen({
  initialSection,
  initialSettings,
  autoplay = false,
}: {
  initialSection?: Section;
  initialSettings?: SettingsTab;
  /** Play the scripted planner session (landing page demo). */
  autoplay?: boolean;
}) {
  const [section, setSection] = useState<Section>(initialSection ?? "overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(initialSettings ?? null);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);
  const openSettings = (tab: SettingsTab | null) => {
    setSettingsTab(tab);
    setAccountOpen(false);
    setMenuOpen(false);
    const url = new URL(window.location.href);
    if (tab) url.searchParams.set("settings", tab);
    else url.searchParams.delete("settings");
    window.history.replaceState(window.history.state, "", url);
  };
  const [orderId, setOrderId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [mobileChat, setMobileChat] = useState(false);
  const [chatClosing, setChatClosing] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const checklistDismissed = useSyncExternalStore(checklistStore.subscribe, checklistStore.get, () => false);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const finishHidingChat = () => {
    setChatOpen(false);
    setMobileChat(false);
    setChatClosing(false);
    hideTimer.current = null;
  };

  const hideChat = () => {
    if (chatClosing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishHidingChat();
      return;
    }
    setChatClosing(true);
    hideTimer.current = window.setTimeout(finishHidingChat, 340);
  };

  // The planner registers its API on mount; asks made while it's hidden wait until it opens.
  const plannerApi = useRef<PlannerApi | null>(null);
  const pending = useRef<string | null>(null);
  const ask = (text: string) => {
    setChatOpen(true);
    setMobileChat(true);
    setMenuOpen(false);
    if (plannerApi.current) plannerApi.current.send(text);
    else pending.current = text;
  };
  const onPlannerReady = (api: PlannerApi | null) => {
    plannerApi.current = api;
    const queued = pending.current;
    if (!api || !queued) return;
    pending.current = null;
    api.send(queued);
  };

  const go = (next: Section) => {
    setSection(next);
    setMenuOpen(false);
    setOrderId(null);
  };
  const openOrder = (id: string) => {
    setOrderId(id);
    setMobileChat(false);
  };

  const { now, event, slots, orders, plan, restaurantById } = useDashboard();
  const steps = [
    plan.slots.length > 0,
    plan.slots.every((p) => p.status === "approved"),
    orders.some((o) => isPlaced(o.status)),
  ];
  const stepsDone = steps.filter(Boolean).length;
  const checklistOpen = !checklistDismissed && stepsDone < steps.length;

  const liveNow = useLiveNow(now);
  const deadlinePhase = deadlineWindowPhase(liveNow, event.startsAt, event.endsAt);
  const pendingOrders = orders.filter((o) => !isPlaced(o.status)).sort((a, b) => a.orderBy.localeCompare(b.orderBy));
  const due = deadlinePhase === "active" ? pendingOrders : [];
  const badges: Partial<Record<Section, { n: number; tone: "new" | "urgent" }>> = {
    orders: { n: due.filter((o) => Date.parse(o.orderBy) - liveNow < 2 * 3_600_000).length, tone: "urgent" },
  };

  const first = deadlinePhase === "ended" ? undefined : pendingOrders[0];
  const firstSlot = first ? slots.find((s) => s.id === first.slotId) : undefined;
  const context: PlannerContext =
    section === "restaurants"
      ? {
          prompt: "I've ranked restaurants near the venue by estimated cost per head. Ask me to compare any two.",
          suggestions: ["Cheapest option for 150 people", "Who does vegan and halal?"],
        }
      : section === "mealcheck"
        ? {
            prompt: "Scan a QR code or search by name. I'll flag anyone collecting twice before seconds open.",
            suggestions: ["How many still to eat?", "Who hasn't eaten today?"],
          }
        : deadlinePhase === "ended"
          ? {
              prompt: `Order deadlines ended at ${calendarDateTime.format(new Date(event.endsAt))}, when ${event.name} ended.`,
              suggestions: ["Are we still under budget?", "Review the event orders"],
            }
          : first && firstSlot
          ? {
              prompt: `Next deadline: order ${firstSlot.label} from ${restaurantById(first.restaurantId).name} by ${calendarDateTime.format(new Date(event.endsAt))}, ${deadlineApproximation(event.startsAt, event.endsAt)}.`,
              suggestions: ["Feed 150, 20 vegan, by 7pm under £1,300", "Plan the whole weekend"],
            }
          : {
              prompt: "Every meal is ordered. Want me to check the budget?",
              suggestions: ["Are we still under budget?", "Plan tomorrow's breakfast"],
            };

  const recent = due.slice(0, 3);
  const panelTitle = NAV.find((n) => n.id === section)!.label;
  const openedOrder = orders.find((o) => o.id === orderId);

  return (
    <div
      className="shell"
      data-collapsed={collapsed || undefined}
      data-menu-open={menuOpen || undefined}
      data-chat={chatOpen ? "open" : "closed"}
      data-mobile-chat={mobileChat || undefined}
      data-chat-closing={chatClosing || undefined}
    >
      <div className="shell-mobilebar">
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Open navigation"
          aria-controls="shell-side"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="panel" />
        </button>
        <span className="shell-mobilebar__title">{panelTitle}</span>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => {
            setChatOpen(true);
            setMobileChat((o) => !o);
          }}>
          <Icon name="pizza" className="icon--brand" />
          {mobileChat ? "Close planner" : "Ask Comeda"}
        </button>
      </div>
      <div className="shell-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <aside className="side" id="shell-side">
        <div className="side__brand">
          <Logo href="/demo" />
          <button
            type="button"
            className="btn btn--icon side__toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => {
              if (menuOpen) setMenuOpen(false);
              else setCollapsed((c) => !c);
            }}
          >
            <Icon name="panel" />
          </button>
        </div>

        <nav className="side__nav" aria-label="Sections">
          {NAV.map((item) => {
            const badge = badges[item.id];
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={active ? "side__item is-active" : "side__item"}
                aria-current={active ? "page" : undefined}
                title={item.label}
                onClick={() => go(item.id)}
              >
                <Icon name={item.icon} />
                <span className="side__label">{item.label}</span>
                {badge && badge.n > 0 && <span className={`side__badge side__badge--${badge.tone}`}>{badge.n}</span>}
              </button>
            );
          })}
          <span className="side__rule" />
          {LINKS.map((item) => (
            <button
              key={item.tab}
              type="button"
              className={settingsTab === item.tab ? "side__item is-active" : "side__item"}
              title={item.label}
              onClick={() => openSettings(item.tab)}
            >
              <Icon name={item.icon} />
              <span className="side__label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="side__section">
          <p className="side__heading">Order next</p>
          <ul>
            {recent.map((order) => {
              const restaurant = restaurantById(order.restaurantId);
              const slot = slots.find((s) => s.id === order.slotId);
              return (
                <li key={order.id}>
                  <button type="button" className="side__recent" onClick={() => openOrder(order.id)} title={restaurant.name}>
                    <RestaurantTile restaurant={restaurant} size="sm" />
                    <span className="side__label">
                      {slot?.label}
                      <span className="side__muted"> · by {clock(order.orderBy)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {checklistOpen && (
          <div className="checklist">
            <div className="checklist__head">
              <span>
                Getting started <span className="side__muted">{stepsDone}/{steps.length}</span>
              </span>
              <button
                type="button"
                className="checklist__close"
                aria-label="Dismiss getting started"
                onClick={checklistStore.dismiss}
              >
                <Icon name="x" />
              </button>
            </div>
            <ul>
              <li className={steps[0] ? "checklist__item is-done" : "checklist__item"}>
                {steps[0] ? <Icon name="check" /> : <span className="checklist__dot" />}
                <button type="button" className="checklist__link" onClick={() => ask("Plan every meal for the weekend")}>
                  Plan every meal
                </button>
              </li>
              <li className={steps[1] ? "checklist__item is-done" : "checklist__item"}>
                {steps[1] ? <Icon name="check" /> : <span className="checklist__dot" />}
                <button type="button" className="checklist__link" onClick={() => go("orders")}>
                  Approve each restaurant
                </button>
              </li>
              <li className={steps[2] ? "checklist__item is-done" : "checklist__item"}>
                {steps[2] ? <Icon name="check" /> : <span className="checklist__dot" />}
                <button type="button" className="checklist__link" onClick={() => go("orders")}>
                  Place your first order
                </button>
              </li>
            </ul>
          </div>
        )}

        <div className="side__account" ref={accountRef}>
          {accountOpen && (
            <div className="side__menu" role="menu" aria-label="Account">
              <p className="side__menu-email">organisers@oxhack.example</p>
              {ACCOUNT_MENU.map((item) => (
                <button key={item.tab} type="button" role="menuitem" onClick={() => openSettings(item.tab)}>
                  <Icon name={item.icon} />
                  {item.label}
                </button>
              ))}
              <span className="side__menu-rule" />
              <form action="/login" method="get">
                <button type="submit" role="menuitem">
                  <Icon name="arrowRight" />
                  Sign out
                </button>
              </form>
            </div>
          )}
          <button
            type="button"
            className="side__me"
            title="OxHack organisers"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((o) => !o)}
          >
            <span className="side__avatar" aria-hidden="true">
              OX
            </span>
            <span className="side__me-text">
              <span className="side__me-name">OxHack organisers</span>
              <span className="side__muted">{event.name}</span>
            </span>
          </button>
          <button
            type="button"
            className="btn btn--icon side__gear"
            aria-label="Settings"
            title="Settings"
            onClick={() => openSettings("event")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </aside>

      {chatOpen ? (
        <div className="chat-viewport">
          <PlannerPane
            context={context}
            autoplay={autoplay}
            onReady={onPlannerReady}
            onHide={hideChat}
          />
        </div>
      ) : (
        <button type="button" className="chat-rail" onClick={() => setChatOpen(true)} aria-label="Show the Comeda planner">
          <Icon name="pizza" className="icon--brand" />
          <span>Ask Comeda</span>
        </button>
      )}

      <main className="panel-main" data-apply={openedOrder ? "" : undefined}>
        {openedOrder ? (
          <OrderBuilderPane key={openedOrder.id} order={openedOrder} onBack={() => setOrderId(null)} />
        ) : section === "overview" ? (
          <OverviewView onOpenOrder={openOrder} onAsk={ask} />
        ) : section === "restaurants" ? (
          <RestaurantsView onAsk={ask} />
        ) : section === "orders" ? (
          <OrdersView onOpenOrder={openOrder} onAsk={ask} />
        ) : (
          <MealCheckView />
        )}
      </main>

      <SettingsDialog tab={settingsTab} onTab={openSettings} onClose={() => openSettings(null)} />
    </div>
  );
}
