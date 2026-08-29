import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, Save, ChevronDown, ChevronUp, Download, Plus, Trash2, ChevronLeft, ChevronRight, X, BookOpen, Timer } from "lucide-react";
import { toast } from "sonner";

// Inject print styles once
const PRINT_STYLE_ID = "teacher-session-print-styles";
function injectPrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      @page { size: Letter portrait; margin: 0.5in; }
      body > *:not(#qr-print-area) { display: none !important; }
      #qr-print-area { display: grid !important; }
    }
    #qr-print-area {
      display: none;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: repeat(3, auto);
      gap: 12px 24px;
      padding: 0;
      font-family: sans-serif;
      width: 100%;
      box-sizing: border-box;
    }
    #qr-print-area .print-qr-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      page-break-inside: avoid;
      break-inside: avoid;
      padding: 10px 12px;
      box-sizing: border-box;
    }
    #qr-print-area .print-qr-item .print-label {
      font-size: 15px;
      font-weight: 700;
      text-align: center;
      color: #111;
    }
    #qr-print-area .print-qr-item .print-sublabel {
      font-size: 11px;
      color: #555;
      text-align: center;
    }
    #qr-print-area .print-qr-item canvas {
      border-radius: 8px;
      padding: 4px;
      background: white;
    }
  `;
  document.head.appendChild(style);
}

// Subtle fade-in for page transitions (no bounce)
const FADE_STYLE = `
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in { animation: fade-in 0.18s ease-out both; }
`;

// Default challenge template for new compartments
function defaultChallenge(sessionId: string, level: number) {
  return {
    session_id: sessionId,
    level,
    type: "sequence",
    story_text: null,
    question_text: "",
    correct_answer_code: "",
    compartment_code: "",
    reveal_message: "",
    keywords: [],
    options: [],
    time_limit_seconds: null,
  };
}

export default function TeacherSession() {
  const { sessionId } = useParams();
  const { user, loading } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [joinQrExpanded, setJoinQrExpanded] = useState(true);
  const [unlockQrExpanded, setUnlockQrExpanded] = useState(false);
  // activePage: -1 = Story page, 0+ = compartment index into challenges array
  const [activePage, setActivePage] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [storySaving, setStorySaving] = useState(false);
  const [storyDirty, setStoryDirty] = useState(false);
  const [localStoryText, setLocalStoryText] = useState<string>("");
  const [addingCompartment, setAddingCompartment] = useState(false);
  const [removingCompartment, setRemovingCompartment] = useState(false);
  const [showAddConfirm, setShowAddConfirm] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [dirtyPages, setDirtyPages] = useState<Set<string>>(new Set());

  useEffect(() => { injectPrintStyles(); }, []);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
      setSession(s);
      const { data: c } = await supabase
        .from("challenges").select("*").eq("session_id", sessionId).order("level");
      setChallenges(c || []);
    })();
  }, [sessionId]);

  // Keep activePage in bounds if challenges shrink
  useEffect(() => {
    if (activePage >= challenges.length && challenges.length > 0) {
      setActivePage(challenges.length - 1);
    }
  }, [challenges.length]);

  // Story text is stored on level-1 challenge — declared here (before the useEffect below)
  const level1Challenge = challenges.find((c) => c.level === 1);

  // Sync localStoryText from DB on initial load (only if not dirty)
  useEffect(() => {
    if (!storyDirty && level1Challenge) {
      setLocalStoryText(level1Challenge.story_text || "");
    }
  }, [level1Challenge?.id]);

  function markDirty(id: string) {
    setDirtyPages((prev) => new Set(prev).add(id));
  }

  // Once a session has started, question_assignments have already been randomly
  // generated per group per compartment (indices into each compartment's pool).
  // Editing the pool afterward (options/keywords/type) desyncs those stored
  // indices from the live content, which can permanently soft-lock groups.
  // So the pool is locked as soon as the session goes live.
  const sessionLocked = !!session?.started_at;

  function updateChallenge(id: string, patch: Record<string, any>) {
    const touchesPool = "options" in patch || "keywords" in patch || "type" in patch;
    if (sessionLocked && touchesPool) {
      toast.error("This session is live — question pools are locked so they stay in sync with what's already been assigned to groups.");
      return;
    }
    setChallenges((arr) => arr.map((x) => x.id === id ? { ...x, ...patch } : x));
    markDirty(id);
  }

  async function saveChallenge(c: any) {
    setSaving(true);
    const { error } = await supabase.from("challenges").update({
      story_text: c.story_text,
      question_text: c.question_text,
      correct_answer_code: c.correct_answer_code,
      compartment_code: c.compartment_code,
      reveal_message: c.reveal_message,
      keywords: c.keywords,
      options: c.options,
      type: c.type,
      time_limit_seconds: c.time_limit_seconds ?? null,
    }).eq("id", c.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Compartment ${c.level} saved`);
      setDirtyPages((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
    }
  }

  async function saveStory(text: string) {
    const level1 = challenges.find((c) => c.level === 1);
    if (!level1) return toast.error("Add at least one compartment before saving the story.");
    setStorySaving(true);
    const { error } = await supabase.from("challenges").update({ story_text: text }).eq("id", level1.id);
    setStorySaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Story saved");
      setChallenges((arr) => arr.map((c) => c.id === level1.id ? { ...c, story_text: text } : c));
      setStoryDirty(false);
    }
  }


  async function addCompartment() {
    if (!sessionId) return;
    if (sessionLocked) { toast.error("This session is live — compartments are locked so they stay in sync with what's already been assigned to groups."); return; }
    setAddingCompartment(true);
    const nextLevel = challenges.length > 0 ? Math.max(...challenges.map((c) => c.level)) + 1 : 1;
    const template = defaultChallenge(sessionId, nextLevel);
    const { data, error } = await supabase.from("challenges").insert(template).select().single();
    setAddingCompartment(false);
    if (error) {
      if (error.message?.includes("challenges_level_check")) {
        toast.error("Your database limits the number of compartments. Run this in Supabase SQL Editor to unlock more: ALTER TABLE challenges DROP CONSTRAINT challenges_level_check;");
      } else {
        toast.error(error.message);
      }
      return;
    }
    setChallenges((prev) => {
      setActivePage(prev.length); // use up-to-date length, not stale closure
      return [...prev, data];
    });
    toast.success(`Compartment ${nextLevel} added`);
  }

  // Trigger removal confirmation modal
  function removeCompartment(c: any) {
    if (sessionLocked) { toast.error("This session is live — compartments are locked so they stay in sync with what's already been assigned to groups."); return; }
    if (challenges.length <= 1) { toast.error("You need at least one compartment."); return; }
    setRemoveTarget(c);
    setShowRemoveConfirm(true);
  }

  // Perform removal after confirmation
  async function confirmRemoveCompartment() {
    const c = removeTarget;
    if (!c) return;
    setShowRemoveConfirm(false);
    setRemovingCompartment(true);
    const { error } = await supabase.from("challenges").delete().eq("id", c.id);
    if (error) { setRemovingCompartment(false); toast.error(error.message); return; }
    // Re-number sequentially one-by-one to avoid transient unique constraint violations.
    const remaining = challenges.filter((x) => x.id !== c.id);
    const renumbered = remaining.map((x, i) => ({ ...x, level: i + 1 }));
    for (const x of renumbered) {
      await supabase.from("challenges").update({ level: x.level }).eq("id", x.id);
    }
    setRemovingCompartment(false);
    setChallenges(renumbered);
    setDirtyPages((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
    toast.success(`Compartment ${c.level} removed`);
    setRemoveTarget(null);
  }

  function downloadQr(canvasId: string, filename: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  if (loading) return <div className="app-shell"><AppHeader /></div>;

  // Inject subtle page-transition keyframe once
  if (typeof document !== "undefined" && !document.getElementById("fade-in-style")) {
    const s = document.createElement("style");
    s.id = "fade-in-style";
    s.textContent = FADE_STYLE;
    document.head.appendChild(s);
  }
  if (!user) return (
    <div className="app-shell">
      <AppHeader />
      <div className="px-4"><Link to="/teacher/login" className="btn-primary inline-block">Sign in</Link></div>
    </div>
  );
  if (!session) return <div className="app-shell"><AppHeader /><div className="px-4 text-center">Loading...</div></div>;

  const joinUrl = `${window.location.origin}/join/${session.id}`;
  const activeChallenge = activePage >= 0 ? (challenges[activePage] ?? null) : null;
  const totalCompartments = challenges.length;
  // All compartments get a QR — including the last one
  const unlockLevels = challenges.map((c) => c.level);

  return (
    <div className="app-shell pb-16">
      <AppHeader subtitle={`Session ${session.join_code}`} />
      <div className="px-4 space-y-4">
        <Link to="/teacher/dashboard" className="text-sm text-action font-semibold flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>

        {/* ── Student Join QR ── */}
        <div className="app-card space-y-3">
          <button
            onClick={() => setJoinQrExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <div className="text-left">
              <div className="font-bold text-primary text-base">Student Join QR</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Display or print this — students scan to register
              </div>
            </div>
            {joinQrExpanded
              ? <ChevronUp className="w-5 h-5 text-muted-foreground" />
              : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
          </button>

          {joinQrExpanded && (
            <div className="space-y-3 animate-pop-in">
              <div className="flex items-center gap-4 bg-muted/40 rounded-2xl p-4">
                <div className="bg-white p-2 rounded-xl shadow">
                  <QRCodeCanvas id="join-qr-canvas" value={joinUrl} size={140} includeMargin />
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Session code</div>
                    <div className="text-3xl font-bold tracking-[0.15em] text-primary mt-0.5">{session.join_code}</div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Students can scan the QR <em>or</em> tap "I'm a Student" and type this code.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadQr("join-qr-canvas", `join-qr-${session.join_code}.png`)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
                >
                  <Download className="w-4 h-4" /> Download QR
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
                >
                  🖨️ Print
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Compartment Unlock QRs ── */}
        <div className="app-card space-y-3">
          <button
            onClick={() => setUnlockQrExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <div className="text-left">
              <div className="font-bold text-primary text-base">Compartment Unlock QRs</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Print and place inside each physical compartment
              </div>
            </div>
            {unlockQrExpanded
              ? <ChevronUp className="w-5 h-5 text-muted-foreground" />
              : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
          </button>

          {unlockQrExpanded && (
            <div className="space-y-3 animate-pop-in">
              <p className="text-xs text-muted-foreground">
                Works for all groups — each student's device is recognised automatically when they scan.
              </p>
              {unlockLevels.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Add at least 1 compartment to generate unlock QRs.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {unlockLevels.map((n) => {
                    const canvasId = `unlock-qr-${n}`;
                    const qrUrl = `${window.location.origin}/session/${sessionId}/scan?from=${n}`;
                    return (
                      <div key={n} className="bg-background rounded-xl p-3 text-center space-y-1.5 border border-border">
                        <div className="text-xs font-semibold text-primary">Compartment {n}</div>
                        <div className="bg-white p-1.5 rounded-lg inline-block">
                          <QRCodeCanvas id={canvasId} value={qrUrl} size={88} includeMargin />
                        </div>
                        <button
                          onClick={() => downloadQr(canvasId, `compartment-${n}-unlock.png`)}
                          className="text-[10px] text-action font-semibold flex items-center justify-center gap-1 mx-auto"
                        >
                          <Download className="w-3 h-3" /> Save
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Challenge Builder — Paginated ── */}
        <div className="app-card space-y-0 overflow-hidden p-0">

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
            <div>
              <div className="font-bold text-primary">Challenge Builder</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {totalCompartments} compartment{totalCompartments !== 1 ? "s" : ""} configured
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Remove button (opens confirm modal) */}
              <button
                onClick={() => activeChallenge && removeCompartment(activeChallenge)}
                disabled={removingCompartment || totalCompartments <= 1 || sessionLocked}
                title={sessionLocked ? "Locked — session is live" : "Remove this compartment"}
                className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {/* Add button (opens confirm modal) */}
              <button
                onClick={() => setShowAddConfirm(true)}
                disabled={addingCompartment || sessionLocked}
                title={sessionLocked ? "Locked — session is live" : "Add compartment"}
                className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-action/50 text-action hover:bg-action/10 transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Pagination tab strip */}
          {challenges.length > 0 && (
            <div className="flex items-center gap-1 px-3 pt-3 pb-2 overflow-x-auto">
              <button
                onClick={() => setActivePage((p) => Math.max(-1, p - 1))}
                disabled={activePage === -1}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Story tab */}
              <button
                onClick={() => setActivePage(-1)}
                className={`relative shrink-0 h-8 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-1 ${
                  activePage === -1
                    ? "bg-action text-white shadow-sm scale-105"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                <BookOpen className="w-3 h-3" />
                Story
                {storyDirty && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 border border-background" />
                )}
              </button>

              {challenges.map((c, i) => {
                const isDirty = dirtyPages.has(c.id);
                const isActive = i === activePage;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActivePage(i)}
                    className={`relative shrink-0 h-8 min-w-[2.5rem] px-3 rounded-lg text-xs font-bold transition-all duration-200 ${
                      isActive
                        ? "bg-action text-white shadow-sm scale-105"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {c.level}
                    {isDirty && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 border border-background" />
                    )}
                  </button>
                );
              })}

              <button
                onClick={() => setActivePage((p) => Math.min(challenges.length - 1, p + 1))}
                disabled={activePage === challenges.length - 1}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Active page form */}
          {activePage === -1 ? (
            // ── Story Page ──
            <div className="px-4 pb-4 pt-2 space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-primary pt-1">
                <BookOpen className="w-4 h-4" />
                <span className="text-sm font-bold">Story</span>
                <span className="text-xs text-muted-foreground ml-1">shown to students before Compartment 1</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Write the narrative students read first. It should contain the clue they need to open the physical padlock on Compartment 1.
              </p>
              <label className="block text-xs">
                <span className="font-semibold text-primary">Story Text</span>
                <textarea
                  className="field-input mt-1 min-h-[240px] text-sm"
                  placeholder="Write the story here…"
                  value={localStoryText}
                  onChange={(e) => { setLocalStoryText(e.target.value); setStoryDirty(true); }}
                />
              </label>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => saveStory(localStoryText)}
                  disabled={storySaving || !storyDirty}
                  className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  {storySaving ? "Saving…" : storyDirty ? "Save Story" : "Saved"}
                </button>
                <button
                  onClick={() => setActivePage(0)}
                  disabled={challenges.length === 0}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                  title="Go to Compartment 1"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Page indicator */}
              <div className="flex justify-center gap-1.5 pt-1">
                {/* Story dot */}
                <button
                  onClick={() => setActivePage(-1)}
                  className="transition-all duration-200 rounded-full w-5 h-1.5 bg-action"
                />
                {challenges.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePage(i)}
                    className="transition-all duration-200 rounded-full w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                  />
                ))}
              </div>
            </div>
          ) : activeChallenge ? (
            <div key={activeChallenge.id} className="px-4 pb-4 pt-2 space-y-3 animate-fade-in">

              {/* Compartment label + type selector */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-primary">
                  Compartment {activeChallenge.level}
                </div>
                <select
                  className="text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:border-action transition disabled:opacity-50"
                  value={activeChallenge.type}
                  disabled={sessionLocked}
                  onChange={(e) => {
                    const newType = e.target.value;
                    const oldType = activeChallenge.type;
                    // Types share a pool shape in these groups:
                    //  - sequence / final_riddle: both use `options` as {variants, display_count}
                    //  - short_answer / long_text: both use `keywords` as {questions, display_count}
                    // Switching within a group keeps the existing pool intact.
                    // Switching to a different group wipes both pool fields so
                    // leftover data from the old type doesn't linger unseen and
                    // silently trip up submission later (it can create an
                    // unanswerable requirement on the Play page).
                    const poolGroup = (t: string) =>
                      t === "sequence" || t === "final_riddle" ? "seq" :
                      t === "short_answer" || t === "long_text" ? "sa" :
                      t; // "multiple_choice" is its own group
                    const sameGroup = poolGroup(oldType) === poolGroup(newType);
                    updateChallenge(activeChallenge.id, sameGroup
                      ? { type: newType }
                      : { type: newType, options: null, keywords: null });
                  }}
                >
                  <option value="sequence">Sequence (code)</option>
                  <option value="multiple_choice">Multiple Choice</option>
                  <option value="short_answer">Short Answer</option>
                  <option value="long_text">Long Text</option>
                  <option value="final_riddle">Riddle</option>
                </select>
              </div>

              {sessionLocked && (
                <div className="rounded-xl bg-amber-400/10 border border-amber-400/30 px-3 py-2.5 text-xs text-amber-700 leading-relaxed">
                  This session is live — question pools, question count, and compartment type are locked so they stay in sync with what's already been randomly assigned to groups. Compartment code, reveal message, and time limit can still be edited.
                </div>
              )}


              {/* Sequence / Riddle multi-variant pool editor */}
              {(activeChallenge.type === "sequence" || activeChallenge.type === "final_riddle") && (() => {
                type SeqVariant = { question_text: string; correct_answer_code: string };
                const rawOpts: any = activeChallenge.options;

                // New wrapped format: { variants: SeqVariant[], display_count: number }
                // Legacy flat format: SeqVariant[] (array directly)
                const isWrapped = rawOpts && !Array.isArray(rawOpts) && "variants" in rawOpts;
                const isLegacyPool = Array.isArray(rawOpts) && rawOpts.length > 0 && "correct_answer_code" in rawOpts[0];

                const variants: SeqVariant[] = isWrapped
                  ? (rawOpts.variants as SeqVariant[])
                  : isLegacyPool
                  ? (rawOpts as SeqVariant[])
                  : [{ question_text: activeChallenge.question_text || "", correct_answer_code: activeChallenge.correct_answer_code || "" }];

                const displayCount: number = isWrapped
                  ? (rawOpts.display_count ?? 1)
                  : 1;

                function savePool(nextVariants: SeqVariant[], nextDisplayCount: number) {
                  const clampedCount = Math.min(Math.max(1, nextDisplayCount), nextVariants.length);
                  updateChallenge(activeChallenge.id, {
                    options: { variants: nextVariants, display_count: clampedCount },
                    question_text: nextVariants[0]?.question_text ?? "",
                    correct_answer_code: nextVariants[0]?.correct_answer_code ?? "",
                  });
                }

                function updateVariant(vi: number, patch: Partial<SeqVariant>) {
                  const next = variants.map((v, i) => i === vi ? { ...v, ...patch } : v);
                  savePool(next, displayCount);
                }

                function addVariant() {
                  savePool([...variants, { question_text: "", correct_answer_code: "" }], displayCount);
                }

                function removeVariant(vi: number) {
                  if (variants.length <= 1) return;
                  const next = variants.filter((_, i) => i !== vi);
                  savePool(next, Math.min(displayCount, next.length));
                }

                const typeLabel = activeChallenge.type === "final_riddle" ? "Riddle" : "Sequence";

                return (
                  <fieldset disabled={sessionLocked} className="space-y-3 disabled:opacity-60">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">
                        {typeLabel} Pool
                        <span className="ml-1.5 font-normal text-muted-foreground">({variants.length} variant{variants.length !== 1 ? "s" : ""})</span>
                      </span>
                    </div>

                    {/* Display count control — only shown when pool has >1 variant */}
                    {variants.length > 1 && (
                      <div className="flex items-center gap-3 rounded-xl bg-muted/30 border border-border px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-primary">Questions shown per group</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Each group gets {displayCount === variants.length ? "all" : displayCount} random variant{displayCount !== 1 ? "s" : ""} from this pool
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => savePool(variants, Math.max(1, displayCount - 1))}
                            disabled={displayCount <= 1}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                          >−</button>
                          <span className="w-8 text-center text-sm font-bold text-primary tabular-nums">{displayCount}</span>
                          <button
                            type="button"
                            onClick={() => savePool(variants, Math.min(variants.length, displayCount + 1))}
                            disabled={displayCount >= variants.length}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                          >+</button>
                          <span className="text-[10px] text-muted-foreground">/ {variants.length}</span>
                        </div>
                      </div>
                    )}

                    {variants.map((v, vi) => (
                      <div key={vi} className="rounded-xl border-2 border-border bg-muted/10 p-3 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="shrink-0 text-[11px] font-bold text-primary bg-muted rounded px-1.5 py-0.5">
                            {variants.length === 1 ? typeLabel : `${typeLabel} ${vi + 1}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeVariant(vi)}
                            disabled={variants.length <= 1}
                            title="Remove variant"
                            className="ml-auto shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <label className="block text-[11px]">
                          <span className="font-semibold text-muted-foreground">Question / Prompt</span>
                          <textarea
                            className="field-input mt-1 min-h-[100px] text-sm"
                            placeholder={`${typeLabel} question or clue…`}
                            value={v.question_text}
                            onChange={(e) => updateVariant(vi, { question_text: e.target.value })}
                          />
                        </label>
                        <label className="block text-[11px]">
                          <span className="font-semibold text-muted-foreground">Correct Answer Code</span>
                          <input
                            className="field-input mt-1 text-sm py-3"
                            placeholder="e.g. 4182"
                            value={v.correct_answer_code}
                            onChange={(e) => updateVariant(vi, { correct_answer_code: e.target.value })}
                          />
                        </label>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addVariant}
                      className="flex items-center gap-1 text-[11px] font-semibold text-action border border-action/40 rounded-lg px-2 py-1 hover:bg-action/10 transition"
                    >
                      <Plus className="w-3 h-3" /> Add {typeLabel}
                    </button>
                  </fieldset>
                );
              })()}

              {/* Multi-Question editor for short_answer and long_text */}
              {(activeChallenge.type === "short_answer" || activeChallenge.type === "long_text") && (() => {
                // keywords stored as:
                //   string[]                → legacy single Q
                //   {text,keywords[]}[]     → legacy multi-Q (flat array)
                //   { questions: {text,keywords[]}[], display_count: number } → new wrapped format
                const raw: any = activeChallenge.keywords;

                type SAQuestion = { text: string; keywords: string[] };
                const isWrapped = raw && !Array.isArray(raw) && "questions" in raw;
                const isLegacyMultiQ = Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && "text" in raw[0];

                const questions: SAQuestion[] = isWrapped
                  ? (raw.questions as SAQuestion[])
                  : isLegacyMultiQ
                  ? (raw as SAQuestion[])
                  : [{ text: activeChallenge.question_text || "", keywords: Array.isArray(raw) ? raw as string[] : [] }];

                const displayCount: number = isWrapped ? (raw.display_count ?? 1) : 1;

                function savePool(nextQs: SAQuestion[], nextCount: number) {
                  const clampedCount = Math.min(Math.max(1, nextCount), nextQs.length);
                  updateChallenge(activeChallenge.id, { keywords: { questions: nextQs, display_count: clampedCount } });
                }

                function updateQText(qi: number, text: string) {
                  savePool(questions.map((q, i) => i === qi ? { ...q, text } : q), displayCount);
                }

                function updateKeywords(qi: number, val: string) {
                  savePool(questions.map((q, i) =>
                    i === qi ? { ...q, keywords: val.split(",").map((s: string) => s.trim()).filter(Boolean) } : q
                  ), displayCount);
                }

                function addQuestion() {
                  savePool([...questions, { text: "", keywords: [] }], displayCount);
                }

                function removeQuestion(qi: number) {
                  if (questions.length <= 1) return;
                  const next = questions.filter((_, i) => i !== qi);
                  savePool(next, Math.min(displayCount, next.length));
                }

                return (
                  <fieldset disabled={sessionLocked} className="space-y-3 disabled:opacity-60">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">
                        Questions
                        <span className="ml-1.5 font-normal text-muted-foreground">({questions.length} total)</span>
                      </span>
                    </div>

                    {/* Display count control — only shown when pool has >1 question */}
                    {questions.length > 1 && (
                      <div className="flex items-center gap-3 rounded-xl bg-muted/30 border border-border px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-primary">Questions shown per group</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Each group gets {displayCount === questions.length ? "all" : displayCount} random question{displayCount !== 1 ? "s" : ""} from this pool
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => savePool(questions, Math.max(1, displayCount - 1))}
                            disabled={displayCount <= 1}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                          >−</button>
                          <span className="w-8 text-center text-sm font-bold text-primary tabular-nums">{displayCount}</span>
                          <button
                            type="button"
                            onClick={() => savePool(questions, Math.min(questions.length, displayCount + 1))}
                            disabled={displayCount >= questions.length}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                          >+</button>
                          <span className="text-[10px] text-muted-foreground">/ {questions.length}</span>
                        </div>
                      </div>
                    )}

                    {questions.map((q, qi) => (
                      <div key={qi} className="rounded-xl border-2 border-border bg-muted/10 p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="shrink-0 text-[11px] font-bold text-primary bg-muted rounded px-1.5 py-0.5 mt-2">Q{qi + 1}</span>
                          <textarea
                            className="field-input flex-1 text-sm min-h-[80px]"
                            placeholder={"Question " + (qi + 1)}
                            value={q.text}
                            onChange={(e) => updateQText(qi, e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => removeQuestion(qi)}
                            disabled={questions.length <= 1}
                            title="Remove question"
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-30 mt-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="pl-8">
                          <label className="block text-[11px] text-muted-foreground font-semibold mb-1">
                            Keywords (comma-separated)
                          </label>
                          <input
                            className="field-input w-full text-sm py-2"
                            placeholder="e.g. warn, truth, listen"
                            value={q.keywords.join(", ")}
                            onChange={(e) => updateKeywords(qi, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addQuestion}
                      className="flex items-center gap-1 text-[11px] font-semibold text-action border border-action/40 rounded-lg px-2 py-1 hover:bg-action/10 transition"
                    >
                      <Plus className="w-3 h-3" /> Add Question
                    </button>
                  </fieldset>
                );
              })()}


              {/* Multi-Question Multiple Choice Editor */}
              {activeChallenge.type === "multiple_choice" && (() => {
                const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const rawOpts: any = activeChallenge.options;

                // Detect format:
                //   wrapped: { questions: [{text, choices:[]}], display_count: N }
                //   legacy multi-Q: [{text, choices:[]}]  (array with choices)
                //   legacy flat: [{label, is_correct}]
                const isWrapped = rawOpts && !Array.isArray(rawOpts) && "questions" in rawOpts;
                const rawArr: any[] = isWrapped ? rawOpts.questions : (Array.isArray(rawOpts) ? rawOpts : []);
                const isLegacyMultiQ = rawArr.length > 0 && "choices" in rawArr[0];

                type Choice = { label: string; is_correct: boolean };
                type Question = { text: string; choices: Choice[] };
                const questions: Question[] = isWrapped
                  ? (rawOpts.questions as Question[])
                  : isLegacyMultiQ
                  ? (rawArr as Question[])
                  : [{ text: activeChallenge.question_text || "", choices: rawArr as Choice[] }];

                const displayCount: number = isWrapped ? (rawOpts.display_count ?? 1) : 1;

                function savePool(next: Question[], nextCount: number) {
                  const clampedCount = Math.min(Math.max(1, nextCount), next.length);
                  updateChallenge(activeChallenge.id, { options: { questions: next, display_count: clampedCount } });
                }

                function choiceText(label: string) {
                  return label.includes(". ") ? label.split(". ").slice(1).join(". ") : label;
                }

                function updateQText(qi: number, text: string) {
                  savePool(questions.map((q, i) => i === qi ? { ...q, text } : q), displayCount);
                }

                function addQuestion() {
                  savePool([...questions, { text: "", choices: [{ label: "A. ", is_correct: true }] }], displayCount);
                }

                function removeQuestion(qi: number) {
                  if (questions.length <= 1) return;
                  const next = questions.filter((_, i) => i !== qi);
                  savePool(next, Math.min(displayCount, next.length));
                }

                function updateChoiceText(qi: number, ci: number, text: string) {
                  const letter = LETTERS[ci] ?? String(ci + 1);
                  savePool(questions.map((q, i) => i !== qi ? q : {
                    ...q,
                    choices: q.choices.map((ch, j) =>
                      j === ci ? { ...ch, label: `${letter}. ${text}` } : ch
                    ),
                  }), displayCount);
                }

                function markCorrect(qi: number, ci: number) {
                  savePool(questions.map((q, i) => i !== qi ? q : {
                    ...q,
                    choices: q.choices.map((ch, j) => ({ ...ch, is_correct: j === ci })),
                  }), displayCount);
                }

                function addChoice(qi: number) {
                  savePool(questions.map((q, i) => {
                    if (i !== qi) return q;
                    const letter = LETTERS[q.choices.length] ?? String(q.choices.length + 1);
                    return { ...q, choices: [...q.choices, { label: `${letter}. `, is_correct: false }] };
                  }), displayCount);
                }

                function removeChoice(qi: number, ci: number) {
                  savePool(questions.map((q, i) => {
                    if (i !== qi) return q;
                    if (q.choices.length <= 1) return q;
                    const filtered = q.choices.filter((_, j) => j !== ci);
                    const relabeled = filtered.map((ch, j) => ({
                      ...ch, label: `${LETTERS[j] ?? j + 1}. ${choiceText(ch.label)}`,
                    }));
                    if (!relabeled.some((ch) => ch.is_correct)) relabeled[0].is_correct = true;
                    return { ...q, choices: relabeled };
                  }), displayCount);
                }

                return (
                  <fieldset disabled={sessionLocked} className="space-y-3 disabled:opacity-60">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">
                        Questions &amp; Choices
                        <span className="ml-1.5 font-normal text-muted-foreground">({questions.length} total)</span>
                      </span>
                    </div>

                    {/* Display count control — only shown when pool has >1 question */}
                    {questions.length > 1 && (
                      <div className="flex items-center gap-3 rounded-xl bg-muted/30 border border-border px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-primary">Questions shown per group</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Each group gets {displayCount === questions.length ? "all" : displayCount} random question{displayCount !== 1 ? "s" : ""} from this pool
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => savePool(questions, Math.max(1, displayCount - 1))}
                            disabled={displayCount <= 1}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                          >−</button>
                          <span className="w-8 text-center text-sm font-bold text-primary tabular-nums">{displayCount}</span>
                          <button
                            type="button"
                            onClick={() => savePool(questions, Math.min(questions.length, displayCount + 1))}
                            disabled={displayCount >= questions.length}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                          >+</button>
                          <span className="text-[10px] text-muted-foreground">/ {questions.length}</span>
                        </div>
                      </div>
                    )}

                    {questions.map((q, qi) => (
                      <div key={qi} className="rounded-xl border-2 border-border bg-muted/10 p-3 space-y-2">
                        {/* Question row */}
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 text-[11px] font-bold text-primary bg-muted rounded px-1.5 py-0.5">Q{qi + 1}</span>
                          <input
                            className="field-input flex-1 text-sm py-2"
                            placeholder={`Question ${qi + 1}`}
                            value={q.text}
                            onChange={(e) => updateQText(qi, e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => removeQuestion(qi)}
                            disabled={questions.length <= 1}
                            title="Remove question"
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Choices */}
                        <div className="space-y-1.5 pl-6">
                          {q.choices.map((ch, ci) => {
                            const letter = LETTERS[ci] ?? String(ci + 1);
                            return (
                              <div key={ci} className="flex items-center gap-1.5">
                                <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition ${
                                  ch.is_correct ? "border-success bg-success text-white" : "border-border bg-muted text-muted-foreground"
                                }`}>{letter}</span>
                                <input
                                  className="field-input flex-1 text-sm py-1.5"
                                  placeholder={`Choice ${letter}`}
                                  value={choiceText(ch.label)}
                                  onChange={(e) => updateChoiceText(qi, ci, e.target.value)}
                                />
                                <button
                                  type="button"
                                  title={ch.is_correct ? "Correct" : "Mark correct"}
                                  onClick={() => markCorrect(qi, ci)}
                                  className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                                    ch.is_correct ? "border-success bg-success" : "border-muted-foreground/50 hover:border-success"
                                  }`}
                                >
                                  {ch.is_correct && <span className="block w-2 h-2 rounded-full bg-white" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeChoice(qi, ci)}
                                  disabled={q.choices.length <= 1}
                                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-30"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => addChoice(qi)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-action hover:underline mt-0.5"
                          >
                            <Plus className="w-3 h-3" /> Add Choice
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addQuestion}
                      className="flex items-center gap-1 text-[11px] font-semibold text-action border border-action/40 rounded-lg px-2 py-1 hover:bg-action/10 transition"
                    >
                      <Plus className="w-3 h-3" /> Add Question
                    </button>
                  </fieldset>
                );
              })()}

              <label className="block text-xs">
                <span className="font-semibold text-primary">Compartment / Padlock Code</span>
                <input
                  className="field-input mt-1 text-sm py-4 sm:py-3"
                  value={activeChallenge.compartment_code || ""}
                  onChange={(e) => updateChallenge(activeChallenge.id, { compartment_code: e.target.value })}
                />
              </label>

              <label className="block text-xs">
                <span className="font-semibold text-primary">Reveal Message</span>
                <textarea
                  className="field-input mt-1 min-h-[120px] sm:min-h-[140px] text-sm"
                  value={activeChallenge.reveal_message || ""}
                  onChange={(e) => updateChallenge(activeChallenge.id, { reveal_message: e.target.value })}
                />
              </label>

              {/* ── Time Limit ── */}
              {(() => {
                const rawSecs: number | null = activeChallenge.time_limit_seconds ?? null;
                const enabled = rawSecs !== null;
                const totalSecs = rawSecs ?? 120;
                const mins = Math.floor(totalSecs / 60);
                const secs = totalSecs % 60;

                function setLimit(m: number, s: number) {
                  const total = Math.max(0, m * 60 + s);
                  updateChallenge(activeChallenge.id, { time_limit_seconds: total === 0 ? null : total });
                }

                return (
                  <div className="rounded-xl border-2 border-border bg-muted/10 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-primary">
                        <Timer className="w-4 h-4" />
                        <span className="text-xs font-semibold">Time Limit per Compartment</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateChallenge(activeChallenge.id, {
                          time_limit_seconds: enabled ? null : 120,
                        })}
                        className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? "bg-action" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? "left-5" : "left-0.5"}`} />
                      </button>
                    </div>

                    {enabled && (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          {/* Minutes */}
                          <div className="flex flex-col items-center gap-0.5">
                            <button type="button" onClick={() => setLimit(mins + 1, secs)}
                              className="w-7 h-6 rounded border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition leading-none">▲</button>
                            <span className="w-10 text-center text-xl font-bold text-primary tabular-nums">
                              {String(mins).padStart(2, "0")}
                            </span>
                            <button type="button" onClick={() => setLimit(Math.max(0, mins - 1), secs)}
                              disabled={mins === 0 && secs <= 10}
                              className="w-7 h-6 rounded border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition leading-none disabled:opacity-30">▼</button>
                          </div>
                          <span className="text-xl font-bold text-primary mb-0.5">:</span>
                          {/* Seconds */}
                          <div className="flex flex-col items-center gap-0.5">
                            <button type="button" onClick={() => {
                              if (secs === 50) setLimit(mins + 1, 0);
                              else setLimit(mins, secs + 10);
                            }}
                              className="w-7 h-6 rounded border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition leading-none">▲</button>
                            <span className="w-10 text-center text-xl font-bold text-primary tabular-nums">
                              {String(secs).padStart(2, "0")}
                            </span>
                            <button type="button" onClick={() => {
                              if (secs === 0) { if (mins > 0) setLimit(mins - 1, 50); }
                              else setLimit(mins, secs - 10);
                            }}
                              disabled={mins === 0 && secs <= 10}
                              className="w-7 h-6 rounded border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition leading-none disabled:opacity-30">▼</button>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-relaxed ml-1">
                          Timer starts when<br />the group opens<br />this compartment
                        </div>
                      </div>
                    )}

                    {!enabled && (
                      <p className="text-[10px] text-muted-foreground">No time limit — groups can take as long as they need.</p>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => saveChallenge(activeChallenge)}
                  disabled={saving}
                  className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : dirtyPages.has(activeChallenge.id) ? "Save Changes" : "Saved"}
                </button>
                {/* Quick prev/next nav */}
                <button
                  onClick={() => setActivePage((p) => Math.max(-1, p - 1))}
                  disabled={activePage === 0}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setActivePage((p) => Math.min(challenges.length - 1, p + 1))}
                  disabled={activePage === challenges.length - 1}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Page indicator */}
              <div className="flex justify-center gap-1.5 pt-1">
                {/* Story dot */}
                <button
                  onClick={() => setActivePage(-1)}
                  className="transition-all duration-200 rounded-full w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                />
                {challenges.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePage(i)}
                    className={`transition-all duration-200 rounded-full ${
                      i === activePage
                        ? "w-5 h-1.5 bg-action"
                        : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 pb-6 pt-4 text-center text-muted-foreground text-sm">
              No compartments yet.{" "}
              <button onClick={() => setShowAddConfirm(true)} className="text-action font-semibold underline">Add one</button>.
            </div>
          )}
        </div>
      </div>

      {/* Add Compartment Confirmation Modal */}
      {showAddConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddConfirm(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-action">
                <Plus className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Add Compartment</h2>
              </div>
              <button onClick={() => setShowAddConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will add a new compartment to the session and assign it the next sequential level. Continue?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddConfirm(false)}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => { setShowAddConfirm(false); await addCompartment(); }}
                disabled={addingCompartment}
                className="flex-1 rounded-xl bg-action py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {addingCompartment ? "Adding…" : "Add Compartment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Compartment Confirmation Modal */}
      {showRemoveConfirm && removeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowRemoveConfirm(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Delete Compartment</h2>
              </div>
              <button onClick={() => setShowRemoveConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will permanently delete Compartment <span className="font-bold text-primary">{removeTarget.level}</span> and its content. This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowRemoveConfirm(false); setRemoveTarget(null); }}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveCompartment}
                disabled={removingCompartment}
                className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {removingCompartment ? "Deleting…" : "Delete Compartment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hidden QR Print Area ── */}
      {createPortal(
        <div id="qr-print-area">
          <div className="print-qr-item print-join-item">
            <div className="print-label">Session Code</div>
            <div className="print-sublabel">{session.join_code}</div>
            <QRCodeCanvas id="print-join-qr" value={joinUrl} size={200} includeMargin />
            <div className="print-sublabel">Scan to join the session</div>
          </div>
          {unlockLevels.map((n) => (
            <div key={n} className="print-qr-item">
              <div className="print-label">Compartment {n}</div>
              <div className="print-sublabel">Place inside compartment {n}</div>
              <QRCodeCanvas
                id={`print-unlock-qr-${n}`}
                value={`${window.location.origin}/session/${sessionId}/scan?from=${n}`}
                size={200}
                includeMargin
              />
              <div className="print-sublabel">Scan to unlock next level</div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}