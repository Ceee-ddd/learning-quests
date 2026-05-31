import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { InfoBox } from "@/components/InfoBox";
import { QRScanner } from "@/components/QRScanner";
import { BookOpen, Key, ScanLine, CheckCircle2, Puzzle, Home } from "lucide-react";
import { toast } from "sonner";

const STRIKES_PER_TIER = 3;       // wrong answers before a cooldown triggers
const COOLDOWN_TIERS_SEC = [5, 10, 15, 20]; // increments, capped at last value

export default function Play() {
  const { groupId } = useParams();
  const [params] = useSearchParams();
  const requestedLevel = parseInt(params.get("level") || "0", 10);
  const nav = useNavigate();

  const [group, setGroup] = useState<any>(null);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "not_started" | "active" | "ended" | "deleted">("loading");
  const [challenges, setChallenges] = useState<any[]>([]);
  const [answer, setAnswer] = useState("");
  const [chosenOption, setChosenOption] = useState<string>("");
  // For multi-question multiple choice: map of questionIndex -> chosen letter
  const [mcAnswers, setMcAnswers] = useState<Record<number, string>>({});
  // For multi-question short_answer/long_text: map of questionIndex -> typed answer
  const [saAnswers, setSaAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [strikes, setStrikes] = useState(0);          // wrong answers in current tier
  const [cooldownTier, setCooldownTier] = useState(0); // how many cooldowns have fired
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState(Date.now());

  // tick for cooldown countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load group + challenges + session status
  useEffect(() => {
    if (!groupId) return;
    (async () => {
      const { data: g } = await supabase.from("groups").select("*").eq("id", groupId).maybeSingle();

      // Group row was deleted (session deleted)
      if (!g) {
        setSessionStatus("deleted");
        return;
      }

      setGroup(g);

      // Check the parent session
      const { data: sess } = await supabase
        .from("sessions")
        .select("started_at, ended_at")
        .eq("id", g.session_id)
        .maybeSingle();

      if (!sess) {
        setSessionStatus("deleted");
        return;
      }

      if (sess.ended_at) {
        setSessionStatus("ended");
        return;
      }

      if (!sess.started_at) {
        setSessionStatus("not_started");
        return;
      }

      setSessionStatus("active");

      const { data: ch } = await supabase
        .from("challenges").select("*").eq("session_id", g.session_id).order("level");
      setChallenges(ch || []);
    })();
  }, [groupId]);

  // Live subscription — watch the session row for ended_at or deletion,
  // AND watch all groups in the session to auto-end when everyone finishes.
  useEffect(() => {
    if (!group?.session_id) return;

    /** Auto-end the session if it's live and every group is finished. */
    async function checkAllGroupsDone() {
      const { data: allGroups } = await supabase
        .from("groups")
        .select("id, finish_time")
        .eq("session_id", group.session_id);
      if (!allGroups || allGroups.length === 0) return;
      if (!allGroups.every((g) => !!g.finish_time)) return;
      // All done — mark session ended (guard with .is("ended_at", null))
      const { error } = await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", group.session_id)
        .is("ended_at", null);
      if (!error) setSessionStatus("ended");
    }

    /** Auto-end the session if started_at is >24 h ago. */
    async function check24h() {
      const { data: sess } = await supabase
        .from("sessions")
        .select("started_at, ended_at")
        .eq("id", group.session_id)
        .maybeSingle();
      if (!sess || sess.ended_at || !sess.started_at) return;
      const age = Date.now() - new Date(sess.started_at).getTime();
      if (age >= 24 * 60 * 60 * 1000) {
        const { error } = await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", group.session_id)
          .is("ended_at", null);
        if (!error) setSessionStatus("ended");
      }
    }

    // Run 24-hour check immediately on mount and every 5 minutes
    check24h();
    const timer24h = setInterval(check24h, 5 * 60 * 1000);

    const ch = supabase
      .channel(`play-session-watch-${group.session_id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${group.session_id}` },
        (payload) => {
          const updated = payload.new as any;
          if (updated.ended_at) setSessionStatus("ended");
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "sessions", filter: `id=eq.${group.session_id}` },
        () => setSessionStatus("deleted")
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "groups", filter: `id=eq.${groupId}` },
        () => setSessionStatus("deleted")
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "groups", filter: `session_id=eq.${group.session_id}` },
        () => checkAllGroupsDone()
      )
      .subscribe();

    return () => {
      clearInterval(timer24h);
      supabase.removeChannel(ch);
    };
  }, [group?.session_id, groupId]);

  const currentLevel = group?.current_level ?? 1;
  // Enforce sequential
  useEffect(() => {
    if (group && requestedLevel && requestedLevel !== currentLevel) {
      toast.error("This challenge is locked. Continue in order.");
    }
  }, [requestedLevel, currentLevel, group]);

  const challenge = useMemo(
    () => challenges.find((c) => c.level === currentLevel),
    [challenges, currentLevel]
  );

  // Reset per-challenge state when level changes
  useEffect(() => {
    setAnswer("");
    setChosenOption("");
    setMcAnswers({});
    setSaAnswers({});
    setSuccess(false);
    setStrikes(0);
    setCooldownTier(0);
    setCooldownUntil(0);
  }, [currentLevel]);

  // Session status gate — shown before the main game UI
  if (sessionStatus !== "active") {
    const statusContent: Record<string, { icon: string | null; heading: string; body: string; showHome: boolean }> = {
      loading: {
        icon: null,
        heading: "Loading…",
        body: "Please wait.",
        showHome: false,
      },
      not_started: {
        icon: "⏳",
        heading: "Session not started yet",
        body: "Your teacher hasn't started the session yet. Hold tight — this page will update automatically once the session goes live.",
        showHome: false,
      },
      ended: {
        icon: "🏁",
        heading: "Session has ended",
        body: "The teacher has closed this session. No further answers can be submitted. Thank you for participating!",
        showHome: true,
      },
      deleted: {
        icon: "🗑️",
        heading: "Session no longer exists",
        body: "This session has been deleted by the teacher. Please ask your teacher for a new join link.",
        showHome: true,
      },
    };
    const sc = statusContent[sessionStatus];

    return (
      <div className="app-shell">
        <AppHeader />
        <div className="px-4">
          <div className="app-card text-center space-y-3 animate-pop-in">
            {sc.icon && (
              <div className="text-4xl">{sc.icon}</div>
            )}
            <h2 className="text-lg font-bold text-primary">{sc.heading}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{sc.body}</p>
            {sc.showHome && (
              <button
                onClick={() => nav("/")}
                className="flex items-center justify-center gap-2 w-full rounded-2xl border-2 border-border py-3 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                <Home className="w-4 h-4" /> Back to Home
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="px-4"><div className="app-card text-center text-muted-foreground">Teacher hasn't configured this challenge yet.</div></div>
      </div>
    );
  }

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const onCooldown = cooldownLeft > 0;

  // Detect whether options is the new multi-question format or legacy flat choices
  function isMQFormat(opts: any[]): boolean {
    return opts.length > 0 && typeof opts[0] === "object" && "choices" in opts[0];
  }

  function validate(input: string): boolean {
    const c = challenge;
    const ans = input.trim().toLowerCase();
    if (c.type === "sequence" || c.type === "final_riddle") {
      return ans === (c.correct_answer_code || "").trim().toLowerCase();
    }
    if (c.type === "multiple_choice") {
      const opts = (c.options as any[]) || [];
      if (isMQFormat(opts)) {
        // Multi-question: all questions must be answered correctly
        return opts.every((q: any, qi: number) => {
          const chosen = mcAnswers[qi];
          if (!chosen) return false;
          const match = (q.choices as any[])?.find((ch: any) => ch.label.startsWith(chosen));
          return !!match?.is_correct;
        });
      }
      // Legacy single-question flat format
      const opt = opts.find((o: any) => o.label.startsWith(input));
      return !!opt?.is_correct;
    }
    if (c.type === "short_answer" || c.type === "long_text") {
      const raw: any = c.keywords || [];
      const isSAMultiQ = raw.length > 0 && typeof raw[0] === "object" && "text" in raw[0];
      if (isSAMultiQ) {
        // Every sub-question answer must hit at least one of its keywords
        return (raw as { text: string; keywords: string[] }[]).every((q, qi) => {
          const ans_i = (saAnswers[qi] || "").trim().toLowerCase();
          if (q.keywords.length === 0) return ans_i.length > 5;
          return q.keywords.some((k: string) => ans_i.includes(k.toLowerCase()));
        });
      }
      // Legacy single-question
      const kws: string[] = (raw as string[]);
      if (kws.length === 0) return ans.length > 5;
      return kws.some((k) => ans.includes(k.toLowerCase()));
    }
    return false;
  }

  async function submit() {
    if (sessionStatus !== "active") return toast.error("The session has ended.");
    if (onCooldown) return;
    const opts = (challenge.options as any[]) || [];
    const isMultiQ = challenge.type === "multiple_choice" && isMQFormat(opts);
    const rawKw: any = challenge.keywords || [];
    const isSAMultiQ = (challenge.type === "short_answer" || challenge.type === "long_text")
      && rawKw.length > 0 && typeof rawKw[0] === "object" && "text" in rawKw[0];
    if (isMultiQ) {
      const unanswered = opts.findIndex((_: any, qi: number) => !mcAnswers[qi]);
      if (unanswered !== -1) return toast.error(`Please answer Question ${unanswered + 1} first.`);
    }
    if (isSAMultiQ) {
      const unanswered = (rawKw as any[]).findIndex((_: any, qi: number) => !(saAnswers[qi] || "").trim());
      if (unanswered !== -1) return toast.error(`Please answer Question ${unanswered + 1} first.`);
    }
    const input = isMultiQ ? "" : isSAMultiQ ? "" : challenge.type === "multiple_choice" ? chosenOption : answer;
    if (!isMultiQ && !isSAMultiQ && !input.trim()) return toast.error("Enter an answer first");

    setBusy(true);
    const ok = validate(input);
    await supabase.from("submissions").insert({
      group_id: groupId!, challenge_level: currentLevel,
      submitted_answer: isMultiQ ? JSON.stringify(mcAnswers) : isSAMultiQ ? JSON.stringify(saAnswers) : input, is_correct: ok,
    });

    if (!group.start_time) {
      await supabase.from("groups").update({ start_time: new Date().toISOString() }).eq("id", groupId!);
    }

    if (ok) {
      setSuccess(true);
      toast.success("Correct!");
    } else {
      const nextStrikes = strikes + 1;
      if (nextStrikes >= STRIKES_PER_TIER) {
        // Trigger cooldown — tier increments up to the last defined value
        const tierIndex = Math.min(cooldownTier, COOLDOWN_TIERS_SEC.length - 1);
        const secs = COOLDOWN_TIERS_SEC[tierIndex];
        setCooldownUntil(Date.now() + secs * 1000);
        setCooldownTier((t) => t + 1);
        setStrikes(0);
        toast.error(`Too many wrong answers! Wait ${secs}s before trying again.`);
      } else {
        setStrikes(nextStrikes);
        const remaining = STRIKES_PER_TIER - nextStrikes;
        toast.error(`Wrong answer — ${remaining} attempt${remaining !== 1 ? "s" : ""} left before cooldown.`);
      }
    }
    setBusy(false);
  }

  async function advanceLevel() {
    if (sessionStatus !== "active") return toast.error("The session has ended.");
    const nextLevel = currentLevel + 1;
    if (nextLevel > 5) {
      // Ensure start_time exists before recording finish
      const finishTime = new Date().toISOString();
      const updates: any = { current_level: 5, finish_time: finishTime };
      if (!group.start_time) updates.start_time = finishTime;
      await supabase.from("groups").update(updates).eq("id", groupId!);
      nav(`/complete/${groupId}`);
      return;
    }
    await supabase.from("groups").update({ current_level: nextLevel }).eq("id", groupId!);
    setGroup({ ...group, current_level: nextLevel });
  }

  function handleScan(text: string) {
    setShowScanner(false);
    try {
      const url = new URL(text, window.location.origin);
      const expected = `/play/${groupId}/scan`;
      if (!url.pathname.startsWith(`/play/${groupId}`)) {
        toast.error("This QR code is for a different group.");
        return;
      }
      const fromLevel = parseInt(url.searchParams.get("from") || "0", 10);
      if (fromLevel !== currentLevel) {
        toast.error("This QR code is for a different compartment.");
        return;
      }
      advanceLevel();
    } catch {
      toast.error("Invalid QR code.");
    }
  }

  // Level 1 shows story first
  return (
    <div className="app-shell pb-12">
      <AppHeader subtitle={`Group: ${group.group_name} · Compartment ${currentLevel}/5`} />
      <div className="px-4 space-y-4">

        {currentLevel === 1 && challenges.find((c) => c.level === 1)?.story_text && (
          <div className="app-card space-y-3">
            <h2 className="text-lg font-bold text-primary">The Last Message of Room 407</h2>
            <p className="text-sm text-muted-foreground">Read the story carefully. You will need details from it to solve the compartments.</p>
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-72 overflow-auto rounded-xl bg-muted/50 p-3">
              {challenges.find((c) => c.level === 1)?.story_text}
            </div>
          </div>
        )}

        <InfoBox icon={Key} label={`Compartment ${currentLevel} Padlock`} tone="warning">
          {currentLevel === 1
            ? `Open Compartment 1 with the code your teacher provided. Scan the QR inside to begin.`
            : `Use the revealed code to open Compartment ${currentLevel}. Scan the QR inside.`}
        </InfoBox>

        <div className="app-card space-y-3 animate-pop-in">
          <div className="flex items-center gap-2 text-primary">
            <Puzzle className="w-5 h-5" />
            <h3 className="font-bold">Compartment {currentLevel} Challenge</h3>
          </div>
          <p className="text-sm whitespace-pre-wrap text-foreground/90">{challenge.question_text}</p>

          {!success && (
            <>
              {challenge.type === "multiple_choice" ? (() => {
                const opts = (challenge.options as any[]) || [];
                const multiQ = isMQFormat(opts);
                if (multiQ) {
                  // Multi-question render
                  return (
                    <div className="space-y-4">
                      {opts.map((q: any, qi: number) => (
                        <div key={qi} className="space-y-2">
                          <p className="text-sm font-semibold text-foreground/90">
                            {qi + 1}. {q.text}
                          </p>
                          <div className="space-y-1.5">
                            {(q.choices as any[]).map((ch: any) => {
                              const letter = ch.label.charAt(0);
                              const sel = mcAnswers[qi] === letter;
                              return (
                                <button
                                  key={ch.label}
                                  type="button"
                                  onClick={() => setMcAnswers((prev) => ({ ...prev, [qi]: letter }))}
                                  className={`w-full text-left rounded-xl px-4 py-2.5 border-2 transition ${
                                    sel ? "border-action bg-action/10" : "border-border bg-card"
                                  }`}
                                >
                                  <span className="font-semibold text-primary">{ch.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }
                // Legacy single-question flat format
                return (
                  <div className="space-y-2">
                    {opts.map((o: any) => {
                      const letter = o.label.charAt(0);
                      const sel = chosenOption === letter;
                      return (
                        <button
                          key={o.label}
                          type="button"
                          onClick={() => setChosenOption(letter)}
                          className={`w-full text-left rounded-xl px-4 py-3 border-2 transition ${
                            sel ? "border-action bg-action/10" : "border-border bg-card"
                          }`}
                        >
                          <span className="font-semibold text-primary">{o.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })() : challenge.type === "long_text" || challenge.type === "short_answer" ? (() => {
                const rawKw: any = challenge.keywords || [];
                const isSAMultiQ = rawKw.length > 0 && typeof rawKw[0] === "object" && "text" in rawKw[0];
                if (isSAMultiQ) {
                  return (
                    <div className="space-y-4">
                      {(rawKw as { text: string; keywords: string[] }[]).map((q, qi) => (
                        <div key={qi} className="space-y-1.5">
                          <p className="text-sm font-semibold text-foreground/90">{qi + 1}. {q.text}</p>
                          <textarea
                            className="field-input min-h-[80px]"
                            placeholder="Write your answer..."
                            value={saAnswers[qi] || ""}
                            maxLength={1000}
                            onChange={(e) => setSaAnswers((prev) => ({ ...prev, [qi]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  );
                }
                // Legacy single question
                return (
                  <textarea
                    className="field-input min-h-[100px]"
                    placeholder="Write your answer..."
                    value={answer}
                    maxLength={1000}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                );
              })() : (
                <input
                  className="field-input"
                  placeholder={challenge.type === "sequence" ? "Enter 4-digit code" : "Your answer"}
                  value={answer}
                  maxLength={50}
                  onChange={(e) => setAnswer(e.target.value)}
                  inputMode={challenge.type === "sequence" ? "numeric" : "text"}
                />
              )}

              {/* Strike indicators */}
              {strikes > 0 && !onCooldown && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {Array.from({ length: STRIKES_PER_TIER }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 flex-1 rounded-full transition-all ${
                          i < strikes ? "bg-destructive" : "bg-muted"
                        }`}
                        style={{ width: 28 }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-destructive font-semibold">
                    {STRIKES_PER_TIER - strikes} attempt{STRIKES_PER_TIER - strikes !== 1 ? "s" : ""} before cooldown
                  </span>
                </div>
              )}

              <button
                onClick={submit}
                disabled={busy || onCooldown}
                className={`btn-primary ${onCooldown ? "opacity-60" : ""}`}
              >
                {onCooldown
                  ? `⏳ Cooldown — ${cooldownLeft}s`
                  : busy ? "Checking..."
                  : "Submit Answer"}
              </button>
            </>
          )}

          {success && (
            <div className="rounded-xl bg-success/10 border-2 border-success p-4 space-y-3 animate-pop-in">
              <div className="flex items-center gap-2 text-success font-bold">
                <CheckCircle2 className="w-6 h-6" /> Code Accepted!
              </div>
              <p className="text-sm text-foreground/80">{challenge.reveal_message}</p>
              {currentLevel < 5 ? (
                <button onClick={() => setShowScanner(true)} className="btn-primary flex items-center justify-center gap-2">
                  <ScanLine className="w-5 h-5" /> Scan Compartment QR
                </button>
              ) : (
                <button onClick={advanceLevel} className="btn-primary">Finish Activity</button>
              )}
            </div>
          )}
        </div>

        {/* Teacher bypass for demo */}
        <button onClick={advanceLevel} className="btn-outline flex items-center justify-center gap-2">
          <BookOpen className="w-4 h-4" /> Next (Teacher use only)
        </button>
      </div>

      {showScanner && <QRScanner onResult={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  );
}