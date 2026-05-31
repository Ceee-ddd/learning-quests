import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { DEFAULT_CHALLENGES, DEFAULT_STORY, genJoinCode } from "@/lib/gameDefaults";
import { Plus, LogOut, ExternalLink, Trophy, QrCode, X, Trash2, PlayCircle, StopCircle, ChevronDown, ChevronUp, Users, History, Clock } from "lucide-react";
import { toast } from "sonner";

// ── FLIP-animated leaderboard row ───────────────────────────────────────────
// Tracks its own DOM position and plays a smooth slide when the list reorders.

const RANK_META: Record<number, { medal: string; border: string; bg: string; text: string; badge: string; glow: string }> = {
  1: {
    medal: "🥇",
    border: "border-yellow-400",
    bg: "bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/10",
    text: "text-yellow-700 dark:text-yellow-400",
    badge: "bg-yellow-400/25 text-yellow-700 dark:text-yellow-400",
    glow: "shadow-[0_0_12px_2px_rgba(250,204,21,0.35)]",
  },
  2: {
    medal: "🥈",
    border: "border-slate-400",
    bg: "bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-800/40 dark:to-gray-800/20",
    text: "text-slate-600 dark:text-slate-300",
    badge: "bg-slate-400/20 text-slate-600 dark:text-slate-300",
    glow: "shadow-[0_0_10px_2px_rgba(148,163,184,0.30)]",
  },
  3: {
    medal: "🥉",
    border: "border-amber-600",
    bg: "bg-gradient-to-r from-orange-50 to-amber-50 dark:from-amber-900/20 dark:to-orange-900/10",
    text: "text-amber-700 dark:text-amber-500",
    badge: "bg-amber-500/20 text-amber-700 dark:text-amber-500",
    glow: "shadow-[0_0_10px_2px_rgba(217,119,6,0.30)]",
  },
};

interface AnimatedRowProps {
  groupId: string;
  rank: number | null;
  isFinished: boolean;
  groupName: string;
  password?: string;
  elapsed: number;
  currentLevel: number;
  pct: number;
  membersExpanded: boolean;
  memberList: string[];
  onToggleExpand: () => void;
}

function AnimatedRow({
  groupId, rank, isFinished, groupName, password, elapsed,
  currentLevel, pct, membersExpanded, memberList, onToggleExpand,
}: AnimatedRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prevTop = useRef<number | null>(null);
  const prevRank = useRef<number | null>(null);
  const [justTookLead, setJustTookLead] = useState(false);

  // Capture position BEFORE React commits the new layout (first-read of FLIP)
  useLayoutEffect(() => {
    if (ref.current) {
      prevTop.current = ref.current.getBoundingClientRect().top;
    }
  });

  // After commit: if position changed, animate from old → new (FLIP invert+play)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || prevTop.current === null) return;
    const newTop = el.getBoundingClientRect().top;
    const delta = prevTop.current - newTop;
    if (Math.abs(delta) < 2) return; // no meaningful movement

    // Detect rank takeover (moved up)
    if (delta > 0) {
      setJustTookLead(true);
      setTimeout(() => setJustTookLead(false), 1200);
    }

    el.style.transform = `translateY(${delta}px)`;
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transform = "";
      el.style.transition = "transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)";
    });
  });

  // Detect when a group newly becomes rank 1
  useEffect(() => {
    if (rank === 1 && prevRank.current !== null && prevRank.current !== 1) {
      setJustTookLead(true);
      setTimeout(() => setJustTookLead(false), 1500);
    }
    prevRank.current = rank;
  }, [rank]);

  const meta = rank !== null && rank <= 3 ? RANK_META[rank] : null;
  const m = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  return (
    <div ref={ref} style={{ willChange: "transform" }}>
      <div
        className={`rounded-xl border-2 overflow-hidden transition-all duration-500 ${
          justTookLead ? "scale-[1.015]" : "scale-100"
        } ${
          meta
            ? `${meta.border} ${meta.bg} ${meta.glow}`
            : isFinished
            ? "border-success bg-success/5"
            : "border-border bg-background/40"
        }`}
      >
        {/* Gold/Silver/Bronze header stripe */}
        {meta && (
          <div className={`h-1 w-full ${
            rank === 1 ? "bg-gradient-to-r from-yellow-300 via-yellow-400 to-amber-300" :
            rank === 2 ? "bg-gradient-to-r from-slate-300 via-slate-400 to-gray-300" :
            "bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600"
          }`} />
        )}

        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between text-sm gap-2">
            <span className="font-semibold flex items-center gap-1.5 truncate">

              {/* Rank badge */}
              {rank !== null ? (
                <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-base font-bold transition-all duration-500 ${
                  meta ? meta.badge : "bg-muted text-muted-foreground text-xs"
                } ${justTookLead ? "animate-bounce" : ""}`}>
                  {meta ? meta.medal : rank}
                </span>
              ) : (
                <span className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                  —
                </span>
              )}

              {/* Group name */}
              <span className={`truncate ${meta ? meta.text + " font-bold" : ""}`}>
                {groupName}
              </span>

              {/* Finished pill */}
              {isFinished && (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success uppercase tracking-wide">
                  <Trophy className="w-3 h-3" /> Done
                </span>
              )}

              {/* "Just took the lead!" flash */}
              {justTookLead && rank === 1 && (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-yellow-400/20 px-2 py-0.5 text-[10px] font-bold text-yellow-600 uppercase tracking-wide animate-pulse">
                  👑 Lead!
                </span>
              )}
            </span>

            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs tabular-nums ${meta ? meta.text : "text-muted-foreground"}`}>
                {isFinished ? `✓ ${m}m ${sec}s` : `L${currentLevel}/5 · ${m}m ${sec}s`}
              </span>
              {memberList.length > 0 && (
                <button
                  onClick={onToggleExpand}
                  className="flex items-center gap-1 text-[10px] font-semibold text-action"
                >
                  <Users className="w-3 h-3" />
                  {memberList.length}
                  {membersExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-muted/60 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-700 ${
                isFinished
                  ? "bg-success"
                  : rank === 1 ? "bg-gradient-to-r from-yellow-400 to-amber-400"
                  : rank === 2 ? "bg-gradient-to-r from-slate-400 to-slate-500"
                  : rank === 3 ? "bg-gradient-to-r from-amber-500 to-orange-500"
                  : "bg-action"
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        {password !== undefined && (
          <div className="px-3 pb-2 text-xs text-muted-foreground">
            Password: <span className="font-semibold text-foreground">{password || "(none)"}</span>
          </div>
        )}
        {membersExpanded && memberList.length > 0 && (
          <div className="border-t border-border bg-muted/30 px-3 py-2.5 space-y-1">
            {memberList.map((name, i) => (
              <div key={i} className="flex items-center gap-2.5 text-[11px]">
                <span className="shrink-0 w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-bold text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="text-foreground/80 font-medium">{name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeacherDashboard() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [qrSession, setQrSession] = useState<any>(null); // session whose QR popover is open
  const [deleteTarget, setDeleteTarget] = useState<any>(null); // session pending deletion
  const [deleteInput, setDeleteInput] = useState(""); // typed confirmation text
  const [deleting, setDeleting] = useState(false);
  const [startingSession, setStartingSession] = useState<string | null>(null); // sessionId being started
  const [endTarget, setEndTarget] = useState<any>(null); // session pending end
  const [ending, setEnding] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set()); // groupIds with expanded members
  const [reuseTarget, setReuseTarget] = useState<any>(null); // session to reuse content from
  const [reusing, setReusing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (!loading && !user) nav("/teacher/login");
  }, [user, loading, nav]);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("sessions").select("*").eq("teacher_id", user.id).order("created_at", { ascending: false });
    setSessions(data || []);
    const sids = (data || []).map((s) => s.id);
    if (sids.length) {
      const { data: g } = await supabase.from("groups").select("*").in("session_id", sids);
      setGroups(g || []);
    } else setGroups([]);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("dashboard-groups")
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user, sessions.length]);

  async function createSession() {
    if (!user) return;
    const code = genJoinCode();
    const { data: s, error } = await supabase
      .from("sessions").insert({ teacher_id: user.id, join_code: code }).select().single();
    if (error) return toast.error(error.message);
    const rows = DEFAULT_CHALLENGES.map((c) => ({
      ...c, session_id: s.id, story_text: c.level === 1 ? DEFAULT_STORY : null,
    }));
    await supabase.from("challenges").insert(rows);
    toast.success(`Session created: ${code}`);
    load();
  }

  async function toggleLate(s: any) {
    await supabase.from("sessions").update({ allow_late_registration: !(s.allow_late_registration ?? false) }).eq("id", s.id);
    load();
  }

  function openDeleteDialog(s: any) {
    setDeleteTarget(s);
    setDeleteInput("");
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setDeleteInput("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const expected = `delete-${deleteTarget.join_code}`;
    if (deleteInput.trim() !== expected) {
      toast.error(`Type exactly: ${expected}`);
      return;
    }
    setDeleting(true);
    try {
      // Delete related data first (challenges, groups), then the session
      await supabase.from("challenges").delete().eq("session_id", deleteTarget.id);
      await supabase.from("groups").delete().eq("session_id", deleteTarget.id);
      const { error } = await supabase.from("sessions").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success(`Session ${deleteTarget.join_code} deleted.`);
      closeDeleteDialog();
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to delete session.");
    } finally {
      setDeleting(false);
    }
  }

  async function startSession(sessionId: string) {
    setStartingSession(sessionId);
    const { error } = await supabase
      .from("sessions")
      .update({ started_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error) toast.error(error.message);
    else {
      toast.success("Session started! All groups are now live.");
      load();
    }
    setStartingSession(null);
  }

  async function endSession(s: any) {
    setEnding(true);
    const { error } = await supabase
      .from("sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", s.id);
    setEnding(false);
    if (error) { toast.error(error.message); return; }
    setEndTarget(null);
    toast.success(`Session ${s.join_code} ended.`);
    load();
  }

  // ── Auto-end helpers ────────────────────────────────────────────────────────

  /** Writes ended_at for a session that should close automatically. */
  async function autoEndSession(sessionId: string, reason: string) {
    const { error } = await supabase
      .from("sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("ended_at", null); // guard: only update if not already ended
    if (!error) {
      toast.info(`Session auto-ended: ${reason}`);
      load();
    }
  }

  /**
   * 24-hour auto-end: checked on load and every 5 minutes while the dashboard
   * is open. Ends any live session whose started_at is >24 h ago.
   */
  useEffect(() => {
    function check() {
      const now = Date.now();
      sessions.forEach((s) => {
        if (s.started_at && !s.ended_at) {
          const age = now - new Date(s.started_at).getTime();
          if (age >= 24 * 60 * 60 * 1000) {
            autoEndSession(s.id, "24-hour time limit reached");
          }
        }
      });
    }
    check(); // run immediately when sessions list changes
    const id = setInterval(check, 5 * 60 * 1000); // re-check every 5 min
    return () => clearInterval(id);
  // eslint-disable-next-line
  }, [sessions]);

  /**
   * All-groups-finished auto-end: runs whenever the groups list changes
   * (driven by the existing realtime subscription). Ends a live session when
   * every registered group has a finish_time.
   */
  useEffect(() => {
    sessions.forEach((s) => {
      if (!s.started_at || s.ended_at) return;
      const sGroups = groups.filter((g) => g.session_id === s.id);
      if (sGroups.length === 0) return; // no groups yet — wait
      const allDone = sGroups.every((g) => !!g.finish_time);
      if (allDone) {
        autoEndSession(s.id, "all groups finished");
      }
    });
  // eslint-disable-next-line
  }, [groups]);

  // ── End auto-end helpers ─────────────────────────────────────────────────────

  async function reuseSession(source: any) {
    if (!user) return;
    setReusing(true);
    try {
      // 1. Fetch challenges from the source session
      const { data: sourceChallenges, error: fetchError } = await supabase
        .from("challenges")
        .select("*")
        .eq("session_id", source.id)
        .order("level");
      if (fetchError) throw fetchError;

      // 2. Create a fresh session with a new join code
      const newCode = genJoinCode();
      const { data: newSession, error: sessionError } = await supabase
        .from("sessions")
        .insert({ teacher_id: user.id, join_code: newCode })
        .select()
        .single();
      if (sessionError) throw sessionError;

      // 3. Copy all challenges into the new session (strip old ids)
      if (sourceChallenges && sourceChallenges.length > 0) {
        const rows = sourceChallenges.map(({ id: _id, session_id: _sid, created_at: _ca, ...rest }: any) => ({
          ...rest,
          session_id: newSession.id,
        }));
        const { error: challengeError } = await supabase.from("challenges").insert(rows);
        if (challengeError) throw challengeError;
      }

      toast.success(`New session created: ${newCode}`);
      setReuseTarget(null);
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to reuse session.");
    } finally {
      setReusing(false);
    }
  }

  function toggleGroupExpand(groupId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    nav("/teacher/login");
  }

  if (loading) return <div className="app-shell"><AppHeader /></div>;

  return (
    <div className="app-shell pb-16">
      <AppHeader subtitle="Teacher Dashboard" />
      <div className="px-4 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateConfirm(true)}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> New Session
          </button>
          {(() => {
            const endedCount = sessions.filter((s) => s.ended_at).length;
            return (
              <button
                onClick={() => setShowHistory(true)}
                className="relative flex items-center gap-1.5 px-3 rounded-full border-2 border-border text-muted-foreground hover:bg-muted/50 transition"
                title="Session history"
              >
                <History className="w-4 h-4" />
                <span className="text-xs font-semibold">History</span>
                {endedCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-action text-white text-[10px] font-bold flex items-center justify-center px-1">
                    {endedCount}
                  </span>
                )}
              </button>
            );
          })()}
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="px-4 rounded-full border-2 border-destructive text-destructive hover:bg-destructive/10 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {sessions.length === 0 && (
          <div className="app-card text-center text-muted-foreground">
            No sessions yet. Create one to begin.
          </div>
        )}
        {sessions.length > 0 && sessions.every((s) => s.ended_at) && (
          <div className="app-card text-center space-y-2">
            <p className="text-muted-foreground text-sm">All sessions have ended.</p>
            <button
              onClick={() => setShowHistory(true)}
              className="text-action text-sm font-semibold underline"
            >
              View History →
            </button>
          </div>
        )}

        {sessions.filter((s) => !s.ended_at).map((s) => {
          const sGroups = groups.filter((g) => g.session_id === s.id);
          const completed = sGroups.filter((g) => g.finish_time).length;
          const joinUrl = `${window.location.origin}/join/${s.id}`;

          return (
            <div key={s.id} className="app-card space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Join code</div>
                  <div className="text-2xl font-bold tracking-wider text-primary">{s.join_code}</div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Quick QR button */}
                  <button
                    onClick={() => setQrSession(qrSession?.id === s.id ? null : s)}
                    className="flex items-center gap-1.5 rounded-xl border-2 border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition"
                  >
                    <QrCode className="w-4 h-4" /> QR
                  </button>
                  <button
                    onClick={() => openDeleteDialog(s)}
                    className="flex items-center gap-1.5 rounded-xl border-2 border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
                    title="Delete session"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <Link
                    to={`/teacher/session/${s.id}`}
                    className="text-action font-semibold flex items-center gap-1 text-sm"
                  >
                    Manage <ExternalLink className="w-4 h-4" />
                  </Link>
                </div>
              </div>

              {/* Inline QR popover */}
              {qrSession?.id === s.id && (
                <div className="bg-muted/40 rounded-2xl p-4 space-y-3 animate-pop-in">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary">Student Join QR</span>
                    <button onClick={() => setQrSession(null)} className="text-muted-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="bg-white p-2 rounded-xl shadow-sm flex-shrink-0">
                      <QRCodeCanvas value={joinUrl} size={110} includeMargin />
                    </div>
                    <div className="space-y-1.5 min-w-0">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Students scan this QR <strong>or</strong> go to the app and type the code:
                      </p>
                      <div className="text-xl font-bold tracking-[0.2em] text-primary">{s.join_code}</div>
                      <a
                        href={joinUrl}
                        className="text-[10px] text-action underline break-all block"
                      >
                        {joinUrl}
                      </a>
                    </div>
                  </div>
                  <Link
                    to={`/teacher/session/${s.id}`}
                    className="text-xs text-action font-semibold"
                  >
                    Full session page (download / print QR) →
                  </Link>
                </div>
              )}

              <label className="flex items-center justify-between text-sm bg-muted/50 rounded-xl px-3 py-2">
                <span className="font-medium">Allow late registration</span>
                <input
                  type="checkbox"
                  checked={s.allow_late_registration ?? false}
                  onChange={() => toggleLate(s)}
                  className="w-5 h-5 accent-[hsl(var(--action))]"
                />
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-primary flex items-center gap-2">
                    Live Leaderboard
                    {s.started_at && !s.ended_at && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-success uppercase tracking-wide">
                        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                        Live
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sGroups.length} groups · {completed} done
                  </span>
                </div>

                {/* Start Session button */}
                {!(s.started_at ?? null) ? (
                  <button
                    onClick={() => startSession(s.id)}
                    disabled={startingSession === s.id || sGroups.length === 0}
                    className="w-full btn-primary flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                  >
                    <PlayCircle className="w-4 h-4" />
                    {startingSession === s.id
                      ? "Starting..."
                      : sGroups.length === 0
                      ? "Waiting for groups to register..."
                      : `Start Session · ${sGroups.length} group${sGroups.length !== 1 ? "s" : ""} ready`}
                  </button>
                ) : !s.ended_at ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-success/10 border border-success/30 py-2.5 text-sm font-semibold text-success">
                      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                      Session Live
                    </div>
                    <button
                      onClick={() => setEndTarget(s)}
                      className="flex items-center gap-1.5 rounded-xl border-2 border-destructive/40 px-3 py-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
                      title="End session"
                    >
                      <StopCircle className="w-4 h-4" /> End
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-muted border border-border py-2.5 text-sm font-semibold text-muted-foreground">
                      <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                      Session Ended
                    </div>
                    <button
                      onClick={() => setReuseTarget(s)}
                      className="flex items-center gap-1.5 rounded-xl border-2 border-action/40 px-3 py-2.5 text-xs font-semibold text-action hover:bg-action/10 transition"
                      title="Reuse this session's content"
                    >
                      <PlayCircle className="w-4 h-4" /> Reuse
                    </button>
                  </div>
                )}

                {sGroups.length === 0 && (
                  <p className="text-xs text-muted-foreground">Waiting for groups to register...</p>
                )}
                {(() => {
                  // Rank finished groups by elapsed time, then append in-progress groups
                  const finishedGroups = sGroups
                    .filter((g) => g.finish_time && g.start_time)
                    .map((g) => ({
                      ...g,
                      elapsed_ms: new Date(g.finish_time).getTime() - new Date(g.start_time).getTime(),
                    }))
                    .sort((a, b) => a.elapsed_ms - b.elapsed_ms);
                  const inProgressGroups = sGroups
                    .filter((g) => !g.finish_time)
                    .sort((a, b) => b.current_level - a.current_level || (a.created_at < b.created_at ? -1 : 1));
                  const sorted = [...finishedGroups, ...inProgressGroups];

                  return sorted.map((g, idx) => {
                    const isFinished = !!g.finish_time;
                    const rank = isFinished ? idx + 1 : null;
                    const elapsed = g.start_time
                      ? Math.round(
                          ((g.finish_time ? +new Date(g.finish_time) : Date.now()) - +new Date(g.start_time)) / 1000
                        )
                      : 0;
                    const pct = isFinished ? 100 : ((g.current_level - 1) / 5) * 100;
                    const membersExpanded = expandedGroups.has(g.id);
                    const memberList: string[] = g.members || [];
                    return (
                      <AnimatedRow
                        key={g.id}
                        groupId={g.id}
                        rank={rank}
                        isFinished={isFinished}
                        groupName={g.group_name}
                        password={g.password}
                        elapsed={elapsed}
                        currentLevel={g.current_level}
                        pct={pct}
                        membersExpanded={membersExpanded}
                        memberList={memberList}
                        onToggleExpand={() => toggleGroupExpand(g.id)}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── History Drawer ── */}
      {showHistory && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowHistory(false); }}
        >
          <style>{`@keyframes slideInRight{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}`}</style>
          <div className="relative w-full max-w-md bg-background h-full flex flex-col shadow-2xl" style={{animation:"slideInRight 0.22s ease-out both"}}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2 text-primary">
                <History className="w-5 h-5" />
                <h2 className="text-lg font-bold">Session History</h2>
                <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                  {sessions.filter((s) => s.ended_at).length}
                </span>
              </div>
              <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable session list */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {sessions.filter((s) => s.ended_at).length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">No ended sessions yet.</p>
              )}
              {sessions.filter((s) => s.ended_at).map((s) => {
                const sGroups = groups.filter((g) => g.session_id === s.id);
                const finishedGroups = sGroups
                  .filter((g) => g.finish_time && g.start_time)
                  .map((g) => ({
                    ...g,
                    elapsed_ms: new Date(g.finish_time).getTime() - new Date(g.start_time).getTime(),
                  }))
                  .sort((a, b) => a.elapsed_ms - b.elapsed_ms);
                const inProgressGroups = sGroups
                  .filter((g) => !g.finish_time)
                  .sort((a, b) => b.current_level - a.current_level);
                const sorted = [...finishedGroups, ...inProgressGroups];
                const endedDate = new Date(s.ended_at);
                const dateLabel = endedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                const timeLabel = endedDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

                return (
                  <div key={s.id} className="app-card space-y-3">
                    {/* Session header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Join code</div>
                        <div className="text-xl font-bold tracking-wider text-primary">{s.join_code}</div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                          <Clock className="w-3 h-3" />
                          Ended {dateLabel} at {timeLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setReuseTarget(s); setShowHistory(false); }}
                          className="flex items-center gap-1 rounded-xl border-2 border-action/40 px-2.5 py-1.5 text-xs font-semibold text-action hover:bg-action/10 transition"
                          title="Reuse content"
                        >
                          <PlayCircle className="w-3.5 h-3.5" /> Reuse
                        </button>
                        <button
                          onClick={() => { openDeleteDialog(s); setShowHistory(false); }}
                          className="flex items-center gap-1 rounded-xl border-2 border-destructive/40 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
                          title="Delete session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Final leaderboard */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold uppercase tracking-wide px-0.5">
                        <span className="flex items-center gap-1"><Trophy className="w-3 h-3" /> Final Results</span>
                        <span>{sGroups.length} group{sGroups.length !== 1 ? "s" : ""} · {finishedGroups.length} finished</span>
                      </div>
                      {sorted.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No groups participated.</p>
                      )}
                      {sorted.map((g, idx) => {
                        const isFinished = !!g.finish_time;
                        const rank = isFinished ? idx + 1 : null;
                        const medals = ["🥇","🥈","🥉"];
                        const m = isFinished ? Math.floor(g.elapsed_ms / 60000) : 0;
                        const sec = isFinished ? Math.floor((g.elapsed_ms % 60000) / 1000) : 0;
                        return (
                          <div
                            key={g.id}
                            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 border text-sm ${
                              rank === 1 ? "border-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10" :
                              rank === 2 ? "border-slate-400 bg-slate-50/50 dark:bg-slate-800/20" :
                              rank === 3 ? "border-amber-500 bg-amber-50/50 dark:bg-amber-900/10" :
                              isFinished ? "border-success/40 bg-success/5" :
                              "border-border bg-background/40"
                            }`}
                          >
                            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold bg-muted/60">
                              {rank !== null && rank <= 3 ? medals[rank - 1] : rank ?? "—"}
                            </span>
                            <span className="flex-1 font-medium truncate">{g.group_name}</span>
                            {isFinished ? (
                              <span className="tabular-nums text-xs text-muted-foreground shrink-0">✓ {m}m {sec}s</span>
                            ) : (
                              <span className="text-xs text-muted-foreground shrink-0">L{g.current_level}/5</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* End Session Confirmation Modal */}
      {endTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEndTarget(null); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-destructive">
                <StopCircle className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">End Session</h2>
              </div>
              <button onClick={() => setEndTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will end session{" "}
              <span className="font-bold text-primary">{endTarget.join_code}</span>. Groups
              already in progress will no longer be able to submit answers. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setEndTarget(null)}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => endSession(endTarget)}
                disabled={ending}
                className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {ending ? "Ending…" : "End Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reuse Session Modal */}
      {reuseTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setReuseTarget(null); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-action">
                <PlayCircle className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Reuse Session Content</h2>
              </div>
              <button onClick={() => setReuseTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will create a <span className="font-semibold text-primary">new session</span> with a fresh join code,
              copying all compartments and challenges from session{" "}
              <span className="font-bold text-primary">{reuseTarget.join_code}</span>.
              The original session will remain unchanged.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setReuseTarget(null)}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => reuseSession(reuseTarget)}
                disabled={reusing}
                className="flex-1 rounded-xl bg-action py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {reusing ? "Creating…" : "Create New Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeDeleteDialog(); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Delete Session</h2>
              </div>
              <button onClick={closeDeleteDialog} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              This will permanently delete session{" "}
              <span className="font-bold text-primary">{deleteTarget.join_code}</span> and all
              associated groups and challenges. This action cannot be undone.
            </p>

            <div className="bg-muted/50 rounded-xl px-3 py-2 text-xs text-muted-foreground">
              To confirm, type:{" "}
              <span className="font-mono font-bold text-destructive select-all">
                delete-{deleteTarget.join_code}
              </span>
            </div>

            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmDelete(); }}
              placeholder={`delete-${deleteTarget.join_code}`}
              className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:border-destructive transition"
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={closeDeleteDialog}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteInput.trim() !== `delete-${deleteTarget.join_code}`}
                className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting…" : "Delete Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Session Confirmation Modal */}
      {showCreateConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateConfirm(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-action">
                <Plus className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Create New Session</h2>
              </div>
              <button onClick={() => setShowCreateConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will create a new session with a fresh join code. Students will be able to join using that code. This action will create associated default challenges.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateConfirm(false)}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => { setShowCreateConfirm(false); setCreating(true); await createSession(); setCreating(false); }}
                disabled={creating}
                className="flex-1 rounded-xl bg-action py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {creating ? "Creating…" : "Create Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowLogoutConfirm(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <LogOut className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Log Out</h2>
              </div>
              <button onClick={() => setShowLogoutConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You will be signed out of the teacher dashboard. Any unsaved local state will be lost. Continue?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => { setShowLogoutConfirm(false); await logout(); }}
                className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-white hover:opacity-90 transition"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}