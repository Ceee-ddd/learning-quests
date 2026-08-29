import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { InfoBox } from "@/components/InfoBox";
import { QRScanner } from "@/components/QRScanner";
import { BookOpen, Key, ScanLine, CheckCircle2, Puzzle, Home, Timer, Star } from "lucide-react";
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
  // Total number of compartments in this session (was hardcoded to 5)
  const totalLevels = challenges.length > 0 ? Math.max(...challenges.map((c) => c.level)) : 5;
  const [answer, setAnswer] = useState("");
  const [chosenOption, setChosenOption] = useState<string>("");
  // For multi-question multiple choice: map of questionIndex -> chosen letter
  const [mcAnswers, setMcAnswers] = useState<Record<number, string>>({});
  // For multi-question short_answer/long_text: map of questionIndex -> typed answer
  const [saAnswers, setSaAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  // "story" phase shown once at the very start (before compartment 1 is opened)
  // "playing" phase shows the challenge for the current level
  const [gamePhase, setGamePhase] = useState<"story" | "playing">("story");

  // When challenges load, skip story phase if there's no story text
  useEffect(() => {
    if (challenges.length > 0) {
      const hasStory = !!challenges.find((c) => c.level === 1)?.story_text;
      if (!hasStory) setGamePhase("playing");
    }
  }, [challenges]);

  // If a student reconnects and is already past level 1, skip story phase
  useEffect(() => {
    if (group && (group.current_level ?? 1) > 1) {
      setGamePhase("playing");
    }
  }, [group?.current_level]);
  const [strikes, setStrikes] = useState(0);          // wrong answers in current tier
  const [cooldownTier, setCooldownTier] = useState(0); // how many cooldowns have fired
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState(Date.now());

  // Per-compartment countdown timer
  const [timeLimitExpiry, setTimeLimitExpiry] = useState<number | null>(null); // epoch ms when timer expires
  const [timeExpired, setTimeExpired] = useState(false);

  // Points system — per-compartment earned points
  // 30 pts: time limit with ≧55 s remaining (or no time limit set)
  // 15 pts: ≧30 s remaining
  //  1 pt : time expired but still answered
  const [compartmentPoints, setCompartmentPoints] = useState<Record<string, number>>({});
  const [lastEarnedPoints, setLastEarnedPoints] = useState<number | null>(null);

  // tick for cooldown countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Start compartment timer when playing phase begins (or challenge changes) and a limit is set
  useEffect(() => {
    if (gamePhase !== "playing") return;
    // challenge is not in scope here yet — resolved later via the useMemo.
    // We trigger this from the challenge useMemo dependency via a separate effect below.
  }, [gamePhase]);

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

      // Hydrate per-compartment points from persisted question_assignments._pts
      const qa = (g.question_assignments as any) ?? {};
      if (qa._pts && typeof qa._pts === "object") {
        setCompartmentPoints(qa._pts as Record<string, number>);
      }

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
  // Assigned question index/indices for this group at the current level (0-based).
  // Stored in group.question_assignments as:
  //   scalar  { "1": 2 }       → single index (legacy / display_count = 1)
  //   array   { "1": [0, 2] }  → multiple indices (display_count > 1)
  const assignedQuestionIndices: number[] = (() => {
    const qa = group?.question_assignments;
    if (!qa) return [0];
    const raw = qa[String(currentLevel)];
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === "number") return [raw];
    return [0];
  })();
  // Backwards-compat: single index for code that still uses it
  const assignedQuestionIndex = assignedQuestionIndices[0] ?? 0;

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

  // Start the compartment countdown when entering playing phase with a time limit set
  useEffect(() => {
    if (gamePhase !== "playing") return;
    if (!challenge) return;
    const secs: number | null = challenge.time_limit_seconds ?? null;
    if (!secs || secs <= 0) {
      setTimeLimitExpiry(null);
      setTimeExpired(false);
      return;
    }
    // Arm a fresh expiry every time we enter a new compartment
    setTimeLimitExpiry(Date.now() + secs * 1000);
    setTimeExpired(false);
  }, [gamePhase, challenge?.id]);

  // Detect expiry each tick
  useEffect(() => {
    if (timeLimitExpiry === null || timeExpired || success) return;
    if (now >= timeLimitExpiry) {
      setTimeExpired(true);
      toast.error("Time's up! Your attempt has been locked.");
    }
  }, [now, timeLimitExpiry, timeExpired, success]);

  // Reset per-challenge state when level changes
  // (timer is armed by the effect above — don't reset it here, or it'll wipe out
  // the new compartment's timer right after it's set)
  useEffect(() => {
    setAnswer("");
    setChosenOption("");
    setMcAnswers({});
    setSaAnswers({});
    setSuccess(false);
    setStrikes(0);
    setCooldownTier(0);
    setCooldownUntil(0);
    setLastEarnedPoints(null);
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

  // Countdown timer
  const timeLeft = timeLimitExpiry !== null ? Math.max(0, Math.ceil((timeLimitExpiry - now) / 1000)) : null;
  const totalTime = challenge?.time_limit_seconds ?? null;
  const timerProgress = (timeLeft !== null && totalTime) ? timeLeft / totalTime : 1;
  const timerUrgent = timeLeft !== null && timeLeft <= 30;

  // Total accumulated points across all completed compartments
  const totalPoints = Object.values(compartmentPoints).reduce((sum, p) => sum + p, 0);

  // ── Pool resolution helpers ──────────────────────────────────────────────────
  // Unwrap the new { variants/questions, display_count } wrapper or fall back to legacy arrays.

  function getSeqVariants(c: any): { question_text: string; correct_answer_code: string }[] {
    const opts = c.options;
    if (opts && !Array.isArray(opts) && "variants" in opts) return opts.variants || [];
    if (Array.isArray(opts) && opts.length > 0 && "correct_answer_code" in opts[0]) return opts;
    return [];
  }

  function getMCQuestions(c: any): { text: string; choices: { label: string; is_correct: boolean }[] }[] {
    const opts = c.options;
    if (opts && !Array.isArray(opts) && "questions" in opts) return opts.questions || [];
    if (Array.isArray(opts) && opts.length > 0 && "choices" in opts[0]) return opts;
    return [];
  }

  function getSAQuestions(c: any): { text: string; keywords: string[] }[] {
    const raw = c.keywords;
    if (raw && !Array.isArray(raw) && "questions" in raw) return raw.questions || [];
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && "text" in raw[0]) return raw;
    return [];
  }

    // ── Points calculation ────────────────────────────────────
  // Returns points earned for a correct answer based on % of time still remaining.
  // 30 pts: 91-100% | 25 pts: 76-90% | 20 pts: 59-75% | 15 pts: 39-58%
  // 10 pts: 16-38%  | 5 pts: 1-15%   | 1 pt: no time left
  // No time limit set on the challenge -> max points (30).
  function calcPointsEarned(): number {
    if (timeExpired) return 1;
    if (timeLimitExpiry === null) return 30;
    const remaining = Math.max(0, Math.ceil((timeLimitExpiry - Date.now()) / 1000));
    const total = challenge?.time_limit_seconds ?? 0;
    if (total <= 0) return 30;
    const pct = (remaining / total) * 100;
    if (pct >= 91) return 30;
    if (pct >= 76) return 25;
    if (pct >= 59) return 20;
    if (pct >= 39) return 15;
    if (pct >= 16) return 10;
    if (pct >= 1) return 5;
    return 1;
  }

  // Visual styling/labels for a given earned-points value (matches tiers above).
  function getPointsTierStyle(pts: number): { bg: string; accent: string; label: string } {
    if (pts >= 30) return { bg: "bg-amber-400/10 border-amber-400/30", accent: "text-amber-500", label: "Lightning fast!" };
    if (pts >= 25) return { bg: "bg-amber-400/10 border-amber-400/30", accent: "text-amber-500", label: "Excellent pace!" };
    if (pts >= 20) return { bg: "bg-sky-400/10 border-sky-400/30", accent: "text-sky-500", label: "Great pace!" };
    if (pts >= 15) return { bg: "bg-sky-400/10 border-sky-400/30", accent: "text-sky-500", label: "Good pace!" };
    if (pts >= 10) return { bg: "bg-muted border-border", accent: "text-muted-foreground", label: "Steady pace" };
    if (pts >= 5) return { bg: "bg-muted border-border", accent: "text-muted-foreground", label: "Answered in time" };
    return { bg: "bg-muted border-border", accent: "text-muted-foreground", label: "Answered after time" };
  }

  // ── Validation ───────────────────────────────────────────────────────────────
  function validate(input: string): boolean {
    const c = challenge;
    const ans = input.trim().toLowerCase();

    if (c.type === "sequence" || c.type === "final_riddle") {
      const variants = getSeqVariants(c);
      if (variants.length > 0) {
        // Single assigned variant (sequence always 1-at-a-time)
        const variant = variants[assignedQuestionIndex] ?? variants[0];
        return ans === (variant?.correct_answer_code ?? "").trim().toLowerCase();
      }
      return ans === (c.correct_answer_code ?? "").trim().toLowerCase();
    }

    if (c.type === "multiple_choice") {
      const mcQs = getMCQuestions(c);
      if (mcQs.length > 0) {
        // All assigned questions must be answered correctly.
        // Skip stale indices (no longer present in the pool) instead of
        // counting them as an automatic wrong answer.
        return assignedQuestionIndices.every((idx) => {
          const q = mcQs[idx];
          if (!q) return true;
          const chosen = mcAnswers[idx];
          if (!chosen) return false;
          const match = q.choices.find((ch) => ch.label.startsWith(chosen));
          return !!match?.is_correct;
        });
      }
      // Legacy single-question flat format
      const opts = (c.options as any[]) || [];
      const opt = opts.find((o: any) => o.label.startsWith(input));
      return !!opt?.is_correct;
    }

    if (c.type === "short_answer" || c.type === "long_text") {
      const saQs = getSAQuestions(c);
      if (saQs.length > 0) {
        // All assigned questions must be answered.
        // Skip stale indices (no longer present in the pool) instead of
        // counting them as an automatic wrong answer.
        return assignedQuestionIndices.every((idx) => {
          const q = saQs[idx];
          if (!q) return true;
          const a = (saAnswers[idx] || "").trim().toLowerCase();
          if (q.keywords.length === 0) return a.length > 5;
          return q.keywords.some((k: string) => a.includes(k.toLowerCase()));
        });
      }
      // Legacy single-question
      const kws: string[] = Array.isArray(c.keywords) ? (c.keywords as string[]) : [];
      if (kws.length === 0) return ans.length > 5;
      return kws.some((k) => ans.includes(k.toLowerCase()));
    }
    return false;
  }


  async function submit() {
    if (sessionStatus !== "active") return toast.error("The session has ended.");
    if (onCooldown) return;

    // Only look at the question pool that actually matches this compartment's
    // type. A compartment can have leftover/unused data sitting in the other
    // field (e.g. `keywords` still holding an old short-answer pool on a
    // compartment that's now `multiple_choice`) — that data is never shown to
    // the player, so it must never be required either.
    const mcQs = challenge.type === "multiple_choice" ? getMCQuestions(challenge) : [];
    const saQs = (challenge.type === "short_answer" || challenge.type === "long_text") ? getSAQuestions(challenge) : [];
    const isMultiMC = mcQs.length > 0;
    const isMultiSA = saQs.length > 0;

    // Guard: all assigned questions must have an answer before submitting.
    // Only count indices that actually resolve to a real question in the current
    // pool — a stale index (e.g. the teacher edited the pool after this group was
    // assigned) is never rendered, so it must never be required either.
    if (isMultiMC) {
      const validIndices = assignedQuestionIndices.filter((idx) => !!mcQs[idx]);
      const missing = validIndices.filter((idx) => !mcAnswers[idx]);
      if (missing.length > 0) return toast.error(`Please answer all ${validIndices.length} question${validIndices.length !== 1 ? "s" : ""} before submitting.`);
    }
    if (isMultiSA) {
      const validIndices = assignedQuestionIndices.filter((idx) => !!saQs[idx]);
      const missing = validIndices.filter((idx) => !(saAnswers[idx] || "").trim());
      if (missing.length > 0) return toast.error(`Please answer all ${validIndices.length} question${validIndices.length !== 1 ? "s" : ""} before submitting.`);
    }

    // Legacy flat MC / sequence / short-answer: need a non-empty text input
    const isLegacyMC = !isMultiMC && challenge.type === "multiple_choice";
    const input = isMultiMC ? "" : isMultiSA ? "" : isLegacyMC ? chosenOption : answer;
    if (!isMultiMC && !isMultiSA && !input.trim()) return toast.error("Enter an answer first");

    setBusy(true);
    const ok = validate(input);
    await supabase.from("submissions").insert({
      group_id: groupId!, challenge_level: currentLevel,
      submitted_answer: isMultiMC ? JSON.stringify(mcAnswers) : isMultiSA ? JSON.stringify(saAnswers) : input,
      is_correct: ok,
    });

    if (!group.start_time) {
      await supabase.from("groups").update({ start_time: new Date().toISOString() }).eq("id", groupId!);
    }

    if (ok) {
      // Award points based on speed
      const pts = calcPointsEarned();
      setLastEarnedPoints(pts);
      const updatedPts = { ...compartmentPoints, [String(currentLevel)]: pts };
      setCompartmentPoints(updatedPts);

      // Persist points into question_assignments._pts (JSONB merge)
      const existingQa = (group.question_assignments as any) ?? {};
      const newQa = { ...existingQa, _pts: updatedPts };
      await supabase.from("groups").update({ question_assignments: newQa }).eq("id", groupId!);

      setSuccess(true);
      toast.success("Correct!");
    } else {
      const nextStrikes = strikes + 1;
      if (nextStrikes >= STRIKES_PER_TIER) {
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
    if (nextLevel > totalLevels) {
      // Ensure start_time exists before recording finish
      const finishTime = new Date().toISOString();
      const updates: any = { current_level: totalLevels, finish_time: finishTime };
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
      const fromLevel = parseInt(url.searchParams.get("from") || "0", 10);

      // Accept session-level QR: /session/<sessionId>/scan?from=<n>
      const isSessionQr = url.pathname.startsWith("/session/") && url.pathname.endsWith("/scan");
      // Accept legacy group-level QR: /play/<groupId>/scan?from=<n>
      const isGroupQr = url.pathname.startsWith(`/play/${groupId}`);

      if (!isSessionQr && !isGroupQr) {
        toast.error("This QR code is not valid for this session.");
        return;
      }

      // During the story phase, scanning Compartment 1's QR transitions into the challenge
      // (the group stays on level 1 — we're just revealing the question now)
      if (gamePhase === "story") {
        if (fromLevel !== 1) {
          toast.error("That's not the Compartment 1 QR. Please scan the QR inside Compartment 1.");
          return;
        }
        setGamePhase("playing");
        toast.success("Compartment 1 opened! Here's your challenge.");
        return;
      }

      // Normal playing phase: after answering correctly, student scans the NEXT compartment's QR
      // to physically open it and advance. So we expect from = currentLevel + 1.
      const expectedLevel = currentLevel + 1;
      if (fromLevel !== expectedLevel) {
        toast.error(`Wrong QR — scan the QR inside Compartment ${expectedLevel} to continue.`);
        return;
      }
      advanceLevel();
    } catch {
      toast.error("Invalid QR code.");
    }
  }

  // ── Story phase: shown once at the very start, before Compartment 1 is opened ──
  const storyText = challenges.find((c) => c.level === 1)?.story_text;
  if (gamePhase === "story" && storyText) {
    return (
      <div className="app-shell pb-12">
        <AppHeader subtitle={`Group: ${group.group_name}`} />
        <div className="px-4 space-y-4">

          <div className="app-card space-y-3 animate-pop-in">
            <div className="flex items-center gap-2 text-primary">
              <BookOpen className="w-5 h-5" />
              <h2 className="text-lg font-bold">The Story</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Read carefully — the story contains the clue to open Compartment 1.
            </p>
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-[60vh] overflow-auto rounded-xl bg-muted/50 p-3">
              {storyText}
            </div>
          </div>

          <InfoBox icon={Key} label="Open Compartment 1" tone="warning">
            Use the clue in the story above to open the physical padlock on Compartment 1.
            Once it's open, scan the QR code inside to begin your first challenge.
          </InfoBox>

          <button
            onClick={() => setShowScanner(true)}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <ScanLine className="w-5 h-5" /> Scan Compartment 1 QR
          </button>

        </div>

        {showScanner && <QRScanner onResult={handleScan} onClose={() => setShowScanner(false)} />}
      </div>
    );
  }

  // ── Playing phase ──
  return (
    <div className="app-shell pb-12">
      <AppHeader subtitle={`Group: ${group.group_name} · Compartment ${currentLevel}/${totalLevels}`} />
      <div className="px-4 space-y-4">

        <InfoBox icon={Key} label={`Compartment ${currentLevel} Padlock`} tone="warning">
          {`Use the revealed code to open Compartment ${currentLevel}. Scan the QR inside.`}
        </InfoBox>

        <div className="app-card space-y-3 animate-pop-in">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-primary">
              <Puzzle className="w-5 h-5" />
              <h3 className="font-bold">Compartment {currentLevel} Challenge</h3>
            </div>

            {/* Countdown timer badge — only shown when a limit is set */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Live points badge — shows accumulated score */}
              {totalPoints > 0 && (
                <div className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold bg-amber-400/15 text-amber-600 border border-amber-400/30 tabular-nums">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  {totalPoints} pts
                </div>
              )}

              {timeLeft !== null && !success && (
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold tabular-nums transition-colors ${
                  timeExpired
                    ? "bg-destructive/15 text-destructive"
                    : timerUrgent
                    ? "bg-destructive/10 text-destructive animate-pulse"
                    : "bg-muted text-foreground"
                }`}>
                  <Timer className="w-3.5 h-3.5 shrink-0" />
                  {timeExpired
                    ? "Time's up"
                    : `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`}
                </div>
              )}
            </div>
          </div>

          {/* Timer progress bar */}
          {timeLeft !== null && !success && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden -mt-1">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  timeExpired ? "bg-destructive" : timerUrgent ? "bg-destructive" : "bg-action"
                }`}
                style={{ width: `${Math.round(timerProgress * 100)}%` }}
              />
            </div>
          )}

          {/* Time expired overlay */}
          {timeExpired && !success && (
            <div className="rounded-xl bg-destructive/10 border-2 border-destructive/40 p-3 text-center space-y-1">
              <p className="text-sm font-bold text-destructive">⏰ Time's up!</p>
              <p className="text-xs text-muted-foreground">You can still answer, but a correct answer now earns only 1 point.</p>
            </div>
          )}

          {/* ── Sequence / Riddle: show assigned variant's prompt + single answer input ── */}
          {(challenge.type === "sequence" || challenge.type === "final_riddle") && (() => {
            const variants = getSeqVariants(challenge);
            const prompt = variants.length > 0
              ? (variants[assignedQuestionIndex] ?? variants[0])?.question_text ?? ""
              : challenge.question_text ?? "";
            return (
              <div className="space-y-3">
                <p className="text-sm whitespace-pre-wrap text-foreground/90">{prompt}</p>
                {!success && (
                  <input
                    className="field-input"
                    placeholder="Enter your answer here"
                    value={answer}
                    maxLength={50}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                )}
              </div>
            );
          })()}

          {/* ── Multiple Choice: show all assigned questions ── */}
          {challenge.type === "multiple_choice" && (() => {
            const mcQs = getMCQuestions(challenge);
            if (mcQs.length > 0) {
              // New multi-Q format — show each assigned question
              return (
                <div className="space-y-4">
                  {assignedQuestionIndices.map((idx, rank) => {
                    const q = mcQs[idx];
                    if (!q) return null;
                    const showLabel = assignedQuestionIndices.length > 1;
                    return (
                      <div key={idx} className="space-y-2">
                        {showLabel && (
                          <span className="text-[11px] font-bold text-primary bg-muted rounded px-1.5 py-0.5">
                            Q{rank + 1}
                          </span>
                        )}
                        <p className="text-sm font-semibold text-foreground/90">{q.text}</p>
                        {!success && (
                          <div className="space-y-1.5">
                            {q.choices.map((ch: any) => {
                              const letter = ch.label.charAt(0);
                              const sel = mcAnswers[idx] === letter;
                              return (
                                <button
                                  key={ch.label}
                                  type="button"
                                  onClick={() => setMcAnswers((prev) => ({ ...prev, [idx]: letter }))}
                                  className={`w-full text-left rounded-xl px-4 py-2.5 border-2 transition ${
                                    sel ? "border-action bg-action/10" : "border-border bg-card"
                                  }`}
                                >
                                  <span className="font-semibold text-primary">{ch.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }
            // Legacy single-question flat format
            const opts = (challenge.options as any[]) || [];
            return (
              <div className="space-y-2">
                <p className="text-sm whitespace-pre-wrap text-foreground/90">{challenge.question_text}</p>
                {!success && opts.map((o: any) => {
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
          })()}

          {/* ── Short Answer / Long Text: show all assigned questions ── */}
          {(challenge.type === "short_answer" || challenge.type === "long_text") && (() => {
            const saQs = getSAQuestions(challenge);
            if (saQs.length > 0) {
              return (
                <div className="space-y-4">
                  {assignedQuestionIndices.map((idx, rank) => {
                    const q = saQs[idx];
                    if (!q) return null;
                    const showLabel = assignedQuestionIndices.length > 1;
                    return (
                      <div key={idx} className="space-y-1.5">
                        {showLabel && (
                          <span className="text-[11px] font-bold text-primary bg-muted rounded px-1.5 py-0.5">
                            Q{rank + 1}
                          </span>
                        )}
                        <p className="text-sm font-semibold text-foreground/90">{q.text}</p>
                        {!success && (
                          <textarea
                            className="field-input min-h-[80px]"
                            placeholder="Write your answer..."
                            value={saAnswers[idx] || ""}
                            maxLength={1000}
                            onChange={(e) => setSaAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }
            // Legacy single question
            return (
              <div className="space-y-1.5">
                <p className="text-sm whitespace-pre-wrap text-foreground/90">{challenge.question_text}</p>
                {!success && (
                  <textarea
                    className="field-input min-h-[100px]"
                    placeholder="Write your answer..."
                    value={answer}
                    maxLength={1000}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                )}
              </div>
            );
          })()}

          {!success && (
            <>
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
                  : timeExpired ? "Submit Answer (1 pt)"
                  : "Submit Answer"}
              </button>
            </>
          )}

          {success && (
            <div className="rounded-xl bg-success/10 border-2 border-success p-4 space-y-3 animate-pop-in">
              <div className="flex items-center gap-2 text-success font-bold">
                <CheckCircle2 className="w-6 h-6" /> Code Accepted!
              </div>

              {/* Points earned for this compartment */}
              {lastEarnedPoints !== null && (() => {
                const tier = getPointsTierStyle(lastEarnedPoints);
                return (
                  <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 border ${tier.bg}`}>
                    <div className="flex items-center gap-2">
                      <Star className={`w-4 h-4 fill-current ${tier.accent}`} />
                      <span className="text-sm font-bold text-foreground">{tier.label}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-xl font-extrabold tabular-nums ${tier.accent}`}>+{lastEarnedPoints}</span>
                      <span className="text-xs text-muted-foreground font-semibold">pts</span>
                    </div>
                  </div>
                );
              })()}

              {/* Running total */}
              {totalPoints > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span>Total score so far</span>
                  <span className="font-bold text-foreground tabular-nums">{totalPoints} pts</span>
                </div>
              )}

              <p className="text-sm text-foreground/80">{challenge.reveal_message}</p>
              {currentLevel < totalLevels ? (
                <button onClick={() => setShowScanner(true)} className="btn-primary flex items-center justify-center gap-2">
                  <ScanLine className="w-5 h-5" /> Scan Compartment QR
                </button>
              ) : (
                <button onClick={advanceLevel} className="btn-primary">Finish Activity</button>
              )}
            </div>
          )}
        </div>

      </div>

      {showScanner && <QRScanner onResult={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  );
}