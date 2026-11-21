// Before the new season (WORLD_SPEC §7.0, slice W2b): the contract screen (your players whose contract
// has run out: offer a new deal or let him go) and the free-agent screen (you sign first). Both show
// each player's interest in your club with its reason and his demand before you offer, and what he
// will answer as you change the offer. Nothing scrolls: the lists are paged.

import { Minus, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  ageAt,
  answerTo,
  canPay,
  expiring,
  freeAgentsBest,
  INTEREST_LABEL,
  lastMinutes,
  Market,
  minimumDeal,
  offseasonOf,
  prospect,
  roomLeft,
  shortOf,
  SQUAD,
  TUNING,
  type Interest,
  type Prospect,
  type Talk,
} from "../../../game/season/contracts";
import { MAX_CONTRACT, money, tidy } from "../../../game/world/money";
import { clubById } from "../../../game/world/query";
import type { World, WorldClub, WorldPlayer } from "../../../game/world/types";
import { NextIcon } from "../../icons";
import { overallRange, Pager, showRange, useFitRows } from "./parts";
import type { Nav } from "./screens";

export interface DealActions {
  onOffer: (id: string, wage: number, years: number) => Talk | null;
  onLetGo: (id: string, go: boolean) => void;
  /** Contract screen done: on to the free agents. */
  onContractsDone: () => void;
  onAutoFill: () => void;
  /** Free-agent screen done: the AI clubs sign, then the season can start. */
  onFreeDone: () => void;
}

const TONE: Record<Interest, string> = {
  wont: "bad",
  reluctant: "warn",
  interested: "ok",
  keen: "good",
};

export function InterestTag({ i }: { i: Prospect["interest"] }) {
  return (
    <span className={`cr-interest ${TONE[i.band]}`}>
      {INTEREST_LABEL[i.band]}
    </span>
  );
}

/** The pay line: "Cap room next season" or "Budget room next season". */
function roomLine(
  w: World,
  club: WorldClub,
  minus = 0,
): { label: string; value: string; warn: boolean } {
  const left = roomLeft(w, club) - minus;
  const cap = club.moneySystem === "cap";
  if (left >= 0)
    return {
      label: cap ? "Cap room next season" : "Budget room next season",
      value: money(left),
      warn: false,
    };
  return {
    label: cap ? "Over the cap by" : "Over the budget by",
    value: money(-left),
    warn: true,
  };
}

/** One line about a player: position, age, overall, last season's minutes. */
function facts(w: World, wp: WorldPlayer): string {
  const mpg = lastMinutes(w, wp);
  return `${wp.p.position} · ${ageAt(w, wp)} yrs · overall ${showRange(overallRange(w, wp))}${wp.status === "club" ? ` · ${mpg.toFixed(1)} min a game` : ""}`;
}

function statusOf(
  wp: WorldPlayer,
  talk: Talk | undefined,
  gone: boolean,
): { text: string; tone: string } {
  if ((wp.contract?.years ?? 0) > 0 && wp.status === "club")
    return {
      text: `Signed · ${wp.contract!.years} yr${wp.contract!.years > 1 ? "s" : ""}`,
      tone: "good",
    };
  if (gone) return { text: "Let go", tone: "muted" };
  if (!talk) return { text: "No offer yet", tone: "muted" };
  if (talk.answer === "ask") return { text: "Asks for more", tone: "warn" };
  if (talk.answer === "no") return { text: "Said no", tone: "bad" };
  return { text: "Signed", tone: "good" };
}

// ---------------------------------------------------------------------------
// The offer panel: wage and years, what he will answer, what it leaves.

function OfferPanel({
  w,
  wp,
  me,
  talk,
  gone,
  actions,
  nav,
}: {
  w: World;
  wp: WorldPlayer;
  me: WorldClub;
  talk?: Talk;
  gone?: boolean;
  actions: DealActions;
  nav: Nav;
}) {
  const m = useMemo(() => new Market(w), [w]);
  const p = prospect(m, wp, me.id);
  const [lo, hi] = TUNING.years[me.moneySystem];
  const floor = minimumDeal(me);
  const [wage, setWage] = useState(p.demand);
  const [years, setYears] = useState(
    Math.min(
      hi,
      Math.max(lo, ageAt(w, wp) <= 26 ? 3 : ageAt(w, wp) <= 30 ? 2 : 1),
    ),
  );
  const step = Math.max(10_000, tidy(p.demand * 0.05));
  const signed =
    wp.status === "club" && (wp.contract?.years ?? 0) > 0 && wp.club === me.id;
  const own = wp.status === "club" && wp.club === me.id;
  const full = !own && me.roster.length >= SQUAD;
  const wont = p.interest.band === "wont";
  const affordable = canPay(w, me, wp, wage);
  const will = answerTo(wage, p.demand);
  const room = roomLine(w, me, wage);
  const predict = wont
    ? {
        text: `Won't consider your club: ${p.interest.reason}. No offer is possible.`,
        tone: "bad",
      }
    : full
      ? { text: `Your squad is full (${SQUAD}).`, tone: "bad" }
      : !affordable
        ? {
            text:
              me.moneySystem === "cap"
                ? own
                  ? "Over the hard ceiling: your club can’t pay this."
                  : "No cap room for this: only a minimum contract fits."
                : "Over your wage budget: only a minimum deal fits.",
            tone: "bad",
          }
        : will === "yes"
          ? { text: "He will say yes.", tone: "good" }
          : will === "ask"
            ? {
                text: `He will ask for his demand (${money(p.demand)}).`,
                tone: "warn",
              }
            : {
                text: `He will say no: ${p.interest.band === "reluctant" ? p.interest.reason : "wants more money"}.`,
                tone: "bad",
              };
  const send = (x = wage) => {
    const t = actions.onOffer(wp.p.id, x, years);
    if (t?.answer === "ask") setWage(p.demand);
  };
  return (
    <section className="cr-card cr-offer" aria-label={`Offer to ${wp.p.name}`}>
      <div className="cr-offer-head">
        <button
          className="cr-name"
          onClick={() => nav.go({ kind: "player", id: wp.p.id })}
        >
          <b>{wp.p.name}</b>
        </button>
        <span className="cr-sub">{facts(w, wp)}</span>
      </div>
      <div className="cr-offer-facts">
        <span className="cr-label">Interest</span>
        <span>
          <InterestTag i={p.interest} /> {p.interest.reason}
        </span>
        <span className="cr-label">Demand</span>
        <b>{money(p.demand)} a year</b>
        {wp.contract && (
          <>
            <span className="cr-label">Wage now</span>
            <span>{money(wp.contract.wage)}</span>
          </>
        )}
      </div>
      {signed ? (
        <p className="cr-offer-note good">
          Signed: {wp.contract!.years} year{wp.contract!.years > 1 ? "s" : ""}{" "}
          at {money(wp.contract!.wage)}.
        </p>
      ) : (
        <>
          <div className="cr-offer-field">
            <span className="cr-label">Yearly wage</span>
            <div className="cr-stepper">
              <button
                className="cr-back icon"
                disabled={wont || wage <= floor}
                onClick={() => setWage(Math.max(floor, wage - step))}
                aria-label="Lower the wage"
                title="Lower the wage"
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <b>{money(wage)}</b>
              <button
                className="cr-back icon"
                disabled={wont || wage >= MAX_CONTRACT}
                onClick={() => setWage(Math.min(MAX_CONTRACT, wage + step))}
                aria-label="Raise the wage"
                title="Raise the wage"
              >
                <Plus size={18} aria-hidden="true" />
              </button>
              <button
                className="cr-chip link"
                disabled={wont || wage === p.demand}
                onClick={() => setWage(p.demand)}
              >
                His demand
              </button>
            </div>
          </div>
          <div className="cr-offer-field">
            <span className="cr-label">Years</span>
            <div className="cr-stepper">
              <button
                className="cr-back icon"
                disabled={wont || years <= lo}
                onClick={() => setYears(years - 1)}
                aria-label="Fewer years"
                title="Fewer years"
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <b>
                {years} · to {w.season + years}
              </b>
              <button
                className="cr-back icon"
                disabled={wont || years >= hi}
                onClick={() => setYears(years + 1)}
                aria-label="More years"
                title="More years"
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p className={`cr-offer-note ${predict.tone}`}>{predict.text}</p>
          <span className={`cr-sub ${room.warn ? "warn" : ""}`}>
            This deal leaves: {room.label.toLowerCase()} {room.value}
          </span>
          {talk && (
            <p
              className={`cr-offer-note ${talk.answer === "yes" ? "good" : talk.answer === "ask" ? "warn" : "bad"}`}
            >
              Your offer of {money(talk.wage)}:{" "}
              {talk.answer === "yes"
                ? "yes"
                : talk.answer === "ask"
                  ? `he asks for ${money(p.demand)}`
                  : "no"}{" "}
              ({talk.reason}).
            </p>
          )}
          <div className="cr-offer-actions">
            {own &&
              (gone ? (
                <button className="cr-chip link" onClick={() => actions.onLetGo(wp.p.id, false)}>
                  Keep talking
                </button>
              ) : (
                <button className="cr-chip link" onClick={() => actions.onLetGo(wp.p.id, true)}>
                  Let him go
                </button>
              ))}
            {talk?.answer === "ask" && wage !== p.demand ? (
              <button className="primary" onClick={() => send(p.demand)}>
                Agree to {money(p.demand)} <NextIcon />
              </button>
            ) : (
              <button
                className="primary"
                disabled={wont || full || !affordable}
                onClick={() => send()}
              >
                Offer <NextIcon />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The contract screen

export function ContractsScreen({
  w,
  nav,
  actions,
}: {
  w: World;
  nav: Nav;
  actions: DealActions;
}) {
  const me = clubById(w, w.human!.club)!;
  const off = offseasonOf(w);
  const m = useMemo(() => new Market(w), [w]);
  // Your expiring players stay listed after you re-sign them (status Signed).
  const [ids] = useState(() => expiring(w, me.id).map((wp) => wp.p.id));
  const list = ids
    .map((id) => w.players[id])
    .filter((wp) => wp.club === me.id || off?.letGo.includes(wp.p.id));
  const [sel, setSel] = useState<string | null>(list[0]?.p.id ?? null);
  const box = useRef<HTMLDivElement>(null);
  const fit = useFitRows(
    list.length,
    ".cr-deals-list tbody tr",
    ids.length,
    box,
    1,
  );
  const room = roomLine(w, me);
  const chosen = sel ? w.players[sel] : undefined;
  return (
    <div className="cr-page cr-page-fill cr-deals">
      <div className="cr-row-head">
        <div>
          <h1>Contracts</h1>
          <span className="cr-sub">
            {list.length
              ? `${list.length} of your players' contracts have run out. Offer each a new deal or let him go.`
              : "No contracts have run out this summer."}
          </span>
        </div>
        <div className="cr-deals-money">
          <span className="cr-label">{room.label}</span>
          <span className={`cr-big ${room.warn ? "warn" : ""}`}>
            {room.value}
          </span>
        </div>
        <button className="primary cr-start" onClick={actions.onContractsDone}>
          On to free agents <NextIcon />
        </button>
      </div>
      <div className="cr-deals-body">
        <section className="cr-card cr-deals-list">
          <div className="cr-deals-box" ref={box}>
            <table className="cr-table cr-deals-table">
              <colgroup><col /><col style={{ width: 92 }} /><col style={{ width: "30%" }} /><col style={{ width: 112 }} /></colgroup>
              <thead>
                <tr>
                  <th className="left">Player</th>
                  <th>Demand</th>
                  <th className="left">Interest in staying</th>
                  <th className="left">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(fit.from, fit.to).map((wp) => {
                  const p = prospect(m, wp, me.id);
                  const st = statusOf(
                    wp,
                    off?.talks[wp.p.id],
                    !!off?.letGo.includes(wp.p.id),
                  );
                  return (
                    <tr key={wp.p.id} className={sel === wp.p.id ? "on" : ""}>
                      <td className="left">
                        <button
                          className="cr-name cr-deal-who"
                          onClick={() => setSel(wp.p.id)}
                          aria-pressed={sel === wp.p.id}
                        >
                          <b>{wp.p.name}</b>
                          <span className="cr-sub">
                            {facts(w, wp)} · now {money(wp.contract?.wage ?? 0)}
                          </span>
                        </button>
                      </td>
                      <td>{money(p.demand)}</td>
                      <td className="left">
                        <span className="cr-deal-interest">
                          <InterestTag i={p.interest} />
                          <span className="cr-sub">{p.interest.reason}</span>
                        </span>
                      </td>
                      <td className={`left ${st.tone}`}>{st.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!list.length && (
              <span className="cr-sub">
                Everyone is under contract for next season.
              </span>
            )}
          </div>
          <Pager fit={fit} total={list.length} />
        </section>
        {chosen ? (
          <OfferPanel
            key={chosen.p.id}
            w={w}
            wp={chosen}
            me={me}
            talk={off?.talks[chosen.p.id]}
            gone={off?.letGo.includes(chosen.p.id)}
            actions={actions}
            nav={nav}
          />
        ) : (
          <section className="cr-card cr-offer cr-sub">
            Choose a player to make an offer.
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The free-agent screen

const POSITIONS = ["All", "PG", "SG", "SF", "PF", "C"] as const;

export function FreeAgentsScreen({
  w,
  nav,
  actions,
}: {
  w: World;
  nav: Nav;
  actions: DealActions;
}) {
  const me = clubById(w, w.human!.club)!;
  const off = offseasonOf(w);
  const m = useMemo(() => new Market(w), [w]);
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("All");
  const [showWont, setShowWont] = useState(false);
  const all = useMemo(
    () => freeAgentsBest(w).map((wp) => ({ wp, p: prospect(m, wp, me.id) })),
    [w, m, me.id],
  );
  const wontCount = all.filter((x) => x.p.interest.band === "wont").length;
  const list = all.filter(
    (x) =>
      (pos === "All" || x.wp.p.position === pos) &&
      (showWont || x.p.interest.band !== "wont"),
  );
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fit = useFitRows(
    list.length,
    ".cr-deals-list tbody tr",
    `${pos}|${showWont}`,
    box,
    1,
  );
  const short = shortOf(w, me.id);
  const room = roomLine(w, me);
  const chosen =
    sel && w.players[sel]?.status === "free"
      ? w.players[sel]
      : list[fit.from]?.wp;
  return (
    <div className="cr-page cr-page-fill cr-deals">
      <div className="cr-row-head">
        <div>
          <h1>Free agents</h1>
          <span className={`cr-sub ${short ? "warn" : ""}`}>
            You have {me.roster.length} of {SQUAD} players
            {short
              ? `: sign ${short} more before the season.`
              : ". You sign first; then the other clubs."}
          </span>
        </div>
        <div className="cr-deals-money">
          <span className="cr-label">{room.label}</span>
          <span className={`cr-big ${room.warn ? "warn" : ""}`}>
            {room.value}
          </span>
        </div>
        <span className="cr-deals-go">
          {short > 0 && (
            <button className="cr-chip link" onClick={actions.onAutoFill}>
              Auto-fill
            </button>
          )}
          <button
            className="primary cr-start"
            disabled={short > 0}
            onClick={actions.onFreeDone}
          >
            {short > 0 ? `Sign ${short} more` : "Done"} <NextIcon />
          </button>
        </span>
      </div>
      <div className="cr-deals-body">
        <section className="cr-card cr-deals-list">
          <div className="cr-deals-filters">
            <div className="cr-tabs" role="radiogroup" aria-label="Position">
              {POSITIONS.map((x) => (
                <button
                  key={x}
                  role="radio"
                  aria-checked={pos === x}
                  className={pos === x ? "on" : ""}
                  onClick={() => setPos(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <button
              className={`cr-toggle ${showWont ? "on" : ""}`}
              aria-pressed={showWont}
              onClick={() => setShowWont(!showWont)}
            >
              {showWont ? "Hide" : "Show"} who won't consider you ({wontCount})
            </button>
          </div>
          <div className="cr-deals-box" ref={box}>
            <table className="cr-table cr-deals-table">
              <colgroup><col /><col style={{ width: 92 }} /><col style={{ width: "36%" }} /></colgroup>
              <thead>
                <tr>
                  <th className="left">Player</th>
                  <th>Demand</th>
                  <th className="left">Interest in your club</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(fit.from, fit.to).map(({ wp, p }) => (
                  <tr
                    key={wp.p.id}
                    className={chosen?.p.id === wp.p.id ? "on" : ""}
                  >
                    <td className="left">
                      <button
                        className="cr-name cr-deal-who"
                        onClick={() => setSel(wp.p.id)}
                        aria-pressed={chosen?.p.id === wp.p.id}
                      >
                        <b>{wp.p.name}</b>
                        <span className="cr-sub">{facts(w, wp)}</span>
                      </button>
                    </td>
                    <td>
                      {p.interest.band === "wont" ? "—" : money(p.demand)}
                    </td>
                    <td className="left">
                      <span className="cr-deal-interest">
                        <InterestTag i={p.interest} />
                        <span className="cr-sub">{p.interest.reason}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && (
              <span className="cr-sub">No free agents here.</span>
            )}
          </div>
          <Pager fit={fit} total={list.length} />
        </section>
        {chosen ? (
          <OfferPanel
            key={chosen.p.id}
            w={w}
            wp={chosen}
            me={me}
            talk={off?.talks[chosen.p.id]}
            actions={actions}
            nav={nav}
          />
        ) : (
          <section className="cr-card cr-offer cr-sub">
            Choose a player to make an offer.
          </section>
        )}
      </div>
    </div>
  );
}
